import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile as execNative} from 'node:child_process';
import {promisify} from 'node:util';
const execNativeAsync=promisify(execNative);
import {tmpdir} from 'node:os';
import {mkdtemp,writeFile,readFile,lstat,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {
  LIVE_REFUSAL,parseRetryArgs,planDwmRetryOffline,
  inspectRetryEvidence,journalOfflineRetryOnce,contractCheckOfflineOnce,LOCKED_CONTRACT_PS
} from './run-retry-once.mjs';

const id='rre_retry_synthetic_20261105_a1';
const hash='a'.repeat(64);
const observed='2026-11-05T23:15:05.000Z';
const captured='2026-11-05T23:15:00.000Z';
const started='2026-11-05T15:31:50.6416621Z';
const target={pid:32156,hwnd:462734,startedUtc:started,sessionId:1};
const outer={pid:32156,hwnd:462734,process:'rift_x64',title:'RIFT',
  className:'TWNClientFramework',ownerHwnd:0,
  isForeground:true,isVisible:true,x:-1928,y:-2,width:1936,height:1048};
const capture={pid:32156,hwnd:462734,process:'rift_x64',
  expectedClass:'TWNClientFramework',title:'RIFT',requestId:id,
  capturedUtc:captured,sha256:hash,width:1920,height:1032,
  inputInjected:false,imageBytesVerified:true,
  imageSha256Verified:true,imageDimensionsVerified:true};
const dwm={x:-1920,y:6,width:1920,height:1032};
const visual={captureRequestId:id,captureSha256:hash,
  attestation:'rrecollector-0.4.11-retry-button-visible',
  rect:{left:1480,top:445,right:1548,bottom:474}};
function fixture(){return {
  target,processBefore:{...target},processAfter:{...target},
  windowBefore:{...outer},windowAfter:{...outer},
  uiaRootAfter:{hwnd:462734,className:'TWNClientFramework',
    isEnabled:true,isOffscreen:false,x:-1928,y:-2,width:1936,height:1048},
  capture:{...capture},visual:{...visual,rect:{...visual.rect}},
  coordinateMapping:{
    mode:'dwm-extended-frame-physical',
    source:'win32-DwmGetWindowAttribute-DWMWA_EXTENDED_FRAME_BOUNDS',
    outerWindow:{x:-1928,y:-2,width:1936,height:1048},
    dwmFrame:{...dwm},clientOrigin:{x:-1920,y:29},
    clientSize:{width:1920,height:1009},dpi:96,
    dpiAwareness:'per-monitor-v2',observedUtc:observed},
  desktop:{coordinateSpace:'physical-virtual-screen-pixels',
    pointerPositionVerified:true},
  dpiAwareness:'per-monitor-v2'
};}
function refusal(e,code){
  assert.throws(()=>planDwmRetryOffline(e,observed),x=>x.code===code);
}
test('DWM origin, not OUTER or CLIENT origin, maps native pixel midpoint',()=>{
  const p=planDwmRetryOffline(fixture(),observed);
  assert.deepEqual(p.virtualScreenPoint,{x:-406,y:465});
  assert.deepEqual(p.sourceDwmRect,dwm);
  assert.equal(p.executable,false);
  assert.equal(p.liveAuthorized,false);
});
test('hard live CLI gate rejects both aliases even when other CLI parameters present',()=>{
  for(const flag of ['--execute-once','--live','--execute-once=yes','--live=yes']){
    assert.throws(()=>parseRetryArgs([flag]),e=>e.code===LIVE_REFUSAL);
  }
  assert.equal(parseRetryArgs(['--preflight-only',path.resolve('example.witness.json')]).mode,'preflight');
  assert.equal(parseRetryArgs(['--contract-check-only',path.resolve('example.witness.json')]).mode,'contract');
  assert.throws(()=>parseRetryArgs(['--preflight-only','relative.json']),e=>e.code==='INVALID_ARGUMENTS');
  assert.throws(()=>parseRetryArgs(['--preflight-only',path.resolve('a'),'--preflight-only',path.resolve('b')]),
    e=>e.code==='INVALID_ARGUMENTS');
});
test('stale PID/HWND/start/session/window/UIA or missing foreground fail closed',()=>{
  refusal({...fixture(),processAfter:{...target,sessionId:9}},'PROCESS_IDENTITY_UNVERIFIED');
  refusal({...fixture(),windowAfter:{...outer,hwnd:3}},'STALE_WINDOW');
  refusal({...fixture(),windowAfter:{...outer,isForeground:false}},'STALE_WINDOW');
  refusal({...fixture(),uiaRootAfter:{...fixture().uiaRootAfter,isOffscreen:true}},'STALE_WINDOW');
});
test('outer size 1936x1048 versus screenshot 1920x1032 is accepted ONLY with DWM proof',()=>{
  assert.equal(planDwmRetryOffline(fixture(),observed).sourceDwmRect.width,1920);
  const a=fixture();a.coordinateMapping.dwmFrame={...dwm,width:1936};
  refusal(a,'DWM_MAPPING_UNVERIFIED');
  const b=fixture();b.coordinateMapping.clientOrigin={x:-1928,y:-2};
  // Client origin may not precede native DWM frame.
  refusal(b,'DWM_MAPPING_UNVERIFIED');
  const c=fixture();c.coordinateMapping.mode='outer-window';
  refusal(c,'DWM_MAPPING_UNVERIFIED');
  const d=fixture();d.coordinateMapping.dpiAwareness='system';
  refusal(d,'DWM_MAPPING_UNVERIFIED');
});
test('capture age, signature, ROI and screenshot hash are individually bound',()=>{
  refusal({...fixture(),capture:{...capture,sha256:'g'.repeat(64)}},'CAPTURE_UNVERIFIED');
  refusal({...fixture(),visual:{...visual,captureSha256:'b'.repeat(64)}},'VISUAL_ATTESTATION_REQUIRED');
  refusal({...fixture(),visual:{...visual,rect:{left:0,top:0,right:1000,bottom:900}}},'UNSAFE_BUTTON_RECT');
  refusal({...fixture(),capture:{...capture,capturedUtc:'2026-11-05T23:13:00.000Z'}},'CAPTURE_STALE');
});
function fakePng(){
  // Only metadata-bearing synthetic fixture, NEVER a screenshot of a user application.
  const b=Buffer.alloc(64);
  Buffer.from('89504e470d0a1a0a','hex').copy(b,0);
  b.writeUInt32BE(13,8);
  b.write('IHDR',12,4,'ascii');
  b.writeUInt32BE(1920,16);b.writeUInt32BE(1032,20);
  b.write('IEND',50,4,'ascii');
  return b;
}
async function syntheticEvidence(){
  const root=await mkdtemp(path.join(tmpdir(),'rift-retry-offline-test-'));
  const e=fixture(),png=fakePng(),info={width:1920,height:1032,sizeBytes:png.length,
    sha256:createHash('sha256').update(png).digest('hex')};
  e.capture.sha256=info.sha256;
  e.capture.capturedUtc=captured;
  e.visual.captureSha256=info.sha256;
  const pngPath=path.join(root,'capture-'+id+'.png');
  const witnessPath=path.join(root,'rift-retry-'+id+'.witness.json');
  e.screenshotPngPath=pngPath;
  await writeFile(pngPath,png);
  await writeFile(path.join(root,'capture-'+id+'.json'),JSON.stringify({
    schemaVersion:1,requestId:id,pid:32156,hwnd:462734,process:'rift_x64',
    expectedClass:'TWNClientFramework',title:'RIFT',capturedUtc:captured,
    imagePath:pngPath,...info,inputInjected:false,foregroundMayChange:true}));
  await writeFile(witnessPath,JSON.stringify(e));
  return {root,e,witnessPath};
}
test('full synthetic witness validates PNG, receipt hash, ROI and DWM plan',async()=>{
  const a=await syntheticEvidence();
  try{
    const r=await inspectRetryEvidence(a.witnessPath,{evidenceRoot:a.root,nowUtc:observed});
    assert.equal(r.ok,true);assert.equal(r.readOnly,true);assert.equal(r.inputAttempted,false);
    assert.deepEqual(r.plan.virtualScreenPoint,{x:-406,y:465});
  }finally{await rm(a.root,{recursive:true,force:true});}
});
test('tampered PNG, witness path, stale time or receipt fails before any journal',async()=>{
  const a=await syntheticEvidence();
  try{
    await assert.rejects(inspectRetryEvidence(a.witnessPath,{evidenceRoot:a.root,nowUtc:'2026-11-05T23:16:00.000Z'}),
      e=>e.code==='CAPTURE_STALE');
    await writeFile(path.join(a.root,'capture-'+id+'.png'),Buffer.alloc(100));
    await assert.rejects(inspectRetryEvidence(a.witnessPath,{evidenceRoot:a.root,nowUtc:observed}),
      e=>e.code==='INVALID_PNG');
    const names=await readdir(a.root);
    assert.ok(!names.some(n=>n.includes('intent')||n.includes('quarantine')));
  }finally{await rm(a.root,{recursive:true,force:true});}
});
test('under both leases, tampered PNG is detected before intent; locks released with no replay marker',async()=>{
  const a=await syntheticEvidence();
  try{
    await assert.rejects(
      journalOfflineRetryOnce(a.witnessPath,{
        evidenceRoot:a.root,nowUtc:observed,
        testHookUnderTurn:()=>writeFile(path.join(a.root,'capture-'+id+'.png'),Buffer.alloc(100))
      }),e=>e.code==='INVALID_PNG');
    const names=await readdir(a.root);
    assert.ok(!names.some(n=>n.includes('intent')||n.includes('receipt.json')&&n.startsWith('rift-retry-')));
    assert.ok(!names.some(n=>n.startsWith('desktop-turn-admission.lock')||
      n==='desktop-input-turn.lock'||n.includes('quarantine')));
  }finally{await rm(a.root,{recursive:true,force:true});}
});

test('P2.1 builds sealed C# contract envelope under both locks and accepts only no-input proof',async()=>{
  const a=await syntheticEvidence();
  try{
    const r=await contractCheckOfflineOnce(a.witnessPath,{evidenceRoot:a.root,nowUtc:observed,
      sender:async validatedPath=>{
        const sealed=JSON.parse(await readFile(validatedPath,'utf8'));
        assert.equal(sealed.capture.imageBytesVerified,true);
        assert.equal(sealed.capture.imageSha256Verified,true);
        assert.equal(sealed.capture.imageDimensionsVerified,true);
        assert.equal(sealed.desktop.windowFramePixelsVerified,true);
        assert.equal(sealed.nowUtc,observed);
        assert.equal(sealed.plan.kind,'physical-rift-retry-DWM-OFFLINE-PLAN');
        assert.deepEqual(sealed.plan.virtualScreenPoint,{x:-406,y:465});
        return {dllSha256:'f'.repeat(64),output:{
          status:'CONTRACT_ONLY_OK_NATIVE_NOT_CHECKED',
          nativeVerified:false,liveInputAllowed:false,inputInjected:false,
          ClickPoint:{X:-406,Y:465}}};
      }});
    assert.equal(r.status,'CROSS_LANGUAGE_CONTRACT_ONLY_OK');
    const receipt=JSON.parse(await readFile(r.receiptPath,'utf8'));
    assert.equal(receipt.nativeVerified,false);
    assert.equal(receipt.inputAttempted,false);
    await assert.rejects(contractCheckOfflineOnce(a.witnessPath,{
      evidenceRoot:a.root,nowUtc:observed,sender:async()=>{throw Error('SHOULD_NOT_REPLAY');}
    }),e=>e.code==='ACTION_RECOVERY_REQUIRED');
    const names=await readdir(a.root);
    assert.ok(!names.some(n=>n==='desktop-input-turn.lock'||n==='desktop-turn-admission.lock'));
  }finally{await rm(a.root,{recursive:true,force:true});}
});
test('C# contract must reproduce point and unambiguous no-input flags, otherwise rejects',async()=>{
  const a=await syntheticEvidence();
  try{
    await assert.rejects(contractCheckOfflineOnce(a.witnessPath,{evidenceRoot:a.root,nowUtc:observed,
      sender:async()=>({output:{status:'CONTRACT_ONLY_OK_NATIVE_NOT_CHECKED',
        nativeVerified:false,liveInputAllowed:false,inputInjected:false,
        ClickPoint:{X:-414,Y:457}}})}),e=>e.code==='CONTRACT_POINT_MISMATCH');
    const names=await readdir(a.root);
    assert.ok(names.some(n=>n.endsWith('.validated.json')));
    assert.ok(!names.some(n=>n==='desktop-input-turn.lock'||n==='desktop-turn-admission.lock'));
  }finally{await rm(a.root,{recursive:true,force:true});}
});

test('P2.1 actual Node-to-C# synthetic JSON/PNG contract (NO Win32, NO input)',async()=>{
  const a=await syntheticEvidence();
  try{
    const e=JSON.parse(await readFile(a.witnessPath,'utf8'));
    const current=Date.now();
    const startedFresh=new Date(current-60000).toISOString();
    const capturedFresh=new Date(current-3000).toISOString();
    const observedFresh=new Date(current-2000).toISOString();
    e.target={...e.target,startedUtc:startedFresh};
    e.processBefore={...e.processBefore,startedUtc:startedFresh};
    e.processAfter={...e.processAfter,startedUtc:startedFresh};
    e.capture.capturedUtc=capturedFresh;
    e.coordinateMapping.observedUtc=observedFresh;
    await writeFile(a.witnessPath,JSON.stringify(e));
    const receiptPath=path.join(a.root,'capture-'+id+'.json');
    const oldReceipt=JSON.parse(await readFile(receiptPath,'utf8'));
    await writeFile(receiptPath,JSON.stringify({...oldReceipt,capturedUtc:capturedFresh}));
    const r=await contractCheckOfflineOnce(a.witnessPath,{evidenceRoot:a.root});
    assert.equal(r.ok,true);
    assert.equal(r.status,'CROSS_LANGUAGE_CONTRACT_ONLY_OK');
    assert.equal(r.nativeVerified,false);
    assert.equal(r.inputAttempted,false);
    assert.deepEqual(r.plan.virtualScreenPoint,{x:-406,y:465});
    const receipt=JSON.parse(await readFile(r.receiptPath,'utf8'));
    assert.match(receipt.senderDllSha256,/^[0-9a-f]{64}$/);
    assert.equal(receipt.senderLockGuard,'win32-filestream-shareread-allowlist-v2');
    assert.equal(receipt.senderArtifactCount,6);
    assert.match(receipt.senderManifestSha256,/^[0-9a-f]{64}$/);
  }finally{await rm(a.root,{recursive:true,force:true});}
});


test('Windows held FileShare.Read DLL blocks disposable replacement and rename race', {
  skip:process.platform!=='win32'
},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'rift-retry-lock-race-'));
  const dll=path.join(root,'disposable-synthetic.dll');
  try{
    await writeFile(dll,Buffer.from('synthetic DLL bytes, never a game binary'));
    const script=String.raw`$ErrorActionPreference='Stop'
$f=$env:RRE_TEST_SHARE_FILE
$renamed=$f+'.renamed'
$held=[System.IO.File]::Open($f,[System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)
try {
  $writeDenied=$false
  $renameDenied=$false
  try{[System.IO.File]::WriteAllText($f,'replacement')}catch [System.IO.IOException]{$writeDenied=$true}
  try{[System.IO.File]::Move($f,$renamed)}catch [System.IO.IOException]{$renameDenied=$true}
  [pscustomobject]@{writeDenied=$writeDenied;renameDenied=$renameDenied}|ConvertTo-Json -Compress
} finally {$held.Dispose()}`;
    const {stdout}=await execNativeAsync(
      'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile','-NonInteractive','-EncodedCommand',
        Buffer.from(script,'utf16le').toString('base64')],
      {timeout:15000,windowsHide:true,maxBuffer:4096,
        env:{...process.env,RRE_TEST_SHARE_FILE:dll}});
    assert.deepEqual(JSON.parse(stdout.trim()),{writeDenied:true,renameDenied:true});
  }finally{await rm(root,{recursive:true,force:true});}
});


test('six-file locked sender rejects tampered and missing synthetic artifacts before launch',{
  skip:process.platform!=='win32'
},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'rift-retry-allowlist-fault-'));
  const names=['sender.dll','sender.deps.json','sender.runtimeconfig.json',
    'FlaUI.Core.dll','System.Management.dll','nested-System.Management.dll'];
  const files=names.map(n=>path.join(root,n));
  const contents=names.map((n,i)=>Buffer.from('synthetic artifact '+i+' '+n));
  try{
    for(let i=0;i<files.length;i++)await writeFile(files[i],contents[i]);
    const manifest=files.map((p,i)=>({path:p,
      sha256:createHash('sha256').update(contents[i]).digest('hex')}));
    const launch=async(expectedCode)=>{
      let failure=null;
      try{
        await execNativeAsync(
          'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          ['-NoProfile','-NonInteractive','-EncodedCommand',
            Buffer.from(LOCKED_CONTRACT_PS,'utf16le').toString('base64')],
          {timeout:15000,windowsHide:true,maxBuffer:4096,
            env:{...process.env,RRE_RETRY_DLL_PATH:files[0],
              RRE_RETRY_DOTNET_PATH:'C:\\nonexistent\\dotnet.exe',
              RRE_RETRY_VALIDATED_PATH:path.join(root,'not-used.validated.json'),
              RRE_RETRY_LOCK_MANIFEST_JSON:JSON.stringify(manifest)}});
      }catch(e){failure=e;}
      const stderr=String(failure?.stderr??'');
      assert.ok(failure&&stderr.includes(expectedCode),
        'Expected '+expectedCode+', observed '+stderr.slice(0,150));
    };
    await writeFile(files[3],Buffer.from('tampered-after-manifest'));
    await launch('LOCKED_ARTIFACT_HASH_CHANGED');
    await writeFile(files[3],contents[3]);
    await rm(files[4]);
    await launch('LOCKED_ARTIFACT_UNAVAILABLE');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('exclusive offline journal records inputAttempted=false once, forbids replay and clears both locks',async()=>{
  const a=await syntheticEvidence();
  try{
    const r=await journalOfflineRetryOnce(a.witnessPath,{evidenceRoot:a.root,nowUtc:observed});
    assert.equal(r.status,'OFFLINE_ONE_SHOT_JOURNALED');assert.equal(r.inputAttempted,false);
    const receipt=JSON.parse(await readFile(path.join(a.root,'rift-retry-'+id+'.receipt.json'),'utf8'));
    assert.equal(receipt.inputAttempted,false);assert.equal(receipt.submitted,false);
    assert.ok((await lstat(path.join(a.root,'rift-retry-singleton.intent.json'))).isFile());
    await assert.rejects(journalOfflineRetryOnce(a.witnessPath,{evidenceRoot:a.root,nowUtc:observed}),
      e=>e.code==='ACTION_RECOVERY_REQUIRED');
    const names=await readdir(a.root);
    assert.ok(!names.some(n=>n.startsWith('desktop-turn-admission.lock')||n==='desktop-input-turn.lock'));
  }finally{await rm(a.root,{recursive:true,force:true});}
});
