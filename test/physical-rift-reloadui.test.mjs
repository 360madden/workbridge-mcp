import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  parseReloadRequest, inspectPhysicalRift, executePhysicalReloadOnce, createGuardedWinappSender,
  readVerifiedChatEvidence, executePhysicalFocusOnce,
} from '../scripts/physical-rift-reloadui.mjs';

const BASE = ['--pid','32156','--hwnd','462734','--started-utc','2026-11-05T19:01:10.123Z',
  '--request-id','physical_rift_reload_test001','--confirm','one-physical-rift-reloadui'];
const target = { pid:32156, hwnd:462734, startedUtc:'2026-11-05T19:01:10.123Z', requestId:'physical_rift_reload_test001' };
const processRecord = { pid:32156, startedUtc:target.startedUtc, sessionId:2 };
const windowRecord = { hwnd:462734, processId:32156, processName:'rift_x64', title:'RIFT',
  className:'TWNClientFramework', ownerHwnd:0, width:1936, height:1048, isForeground:true };
const treeRecord = { windows:[{hwnd:462734,elements:[{ type:'Window',name:'RIFT',
  className:'TWNClientFramework',isEnabled:true,isOffscreen:false,
  x:-1928,y:-2,width:1936,height:1048,selector:'win-rift-5475' }]}] };

function fakes(windowOverrides = {}) {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    if(args[0]==='--version')return 'WinApp CLI 0.7.1\n';
    if(args[1]==='list-windows')return JSON.stringify([{...windowRecord,...windowOverrides}]);
    if(args[1]==='inspect')return JSON.stringify(treeRecord);
    throw new Error('UNEXPECTED_COMMAND');
  };
  return { runner, calls, getProcess:async(pid)=>pid===process.pid ? {pid,startedUtc:target.startedUtc,sessionId:2} : {...processRecord} };
}

async function temp() { return await mkdtemp(path.join(os.tmpdir(),'wb-rift-reload-test-')); }

test('strict CLI only accepts explicit physical RIFT target and confirmation', ()=>{
  const v=parseReloadRequest(BASE);
  assert.equal(v.pid,32156);assert.equal(v.hwnd,462734);assert.equal(v.preflightOnly,false);
  assert.throws(()=>parseReloadRequest(BASE.slice(0,-2)),{code:'CONFIRMATION_REQUIRED'});
  assert.throws(()=>parseReloadRequest([...BASE,'--command','/quit']),{code:'INVALID_ARGUMENTS'});
  assert.throws(()=>parseReloadRequest([...BASE,'--request-id','another']),{code:'INVALID_ARGUMENTS'});
  assert.throws(()=>parseReloadRequest(BASE.map(x=>x==='2026-11-05T19:01:10.123Z'?'junk':x)),{code:'INVALID_PROCESS_START'});
});

test('read-only physical preflight requires foreground/process class/title/geometry/start',async()=>{
  const t=fakes();
  const result=await inspectPhysicalRift(target,t);
  assert.equal(result.process,'rift_x64');
  assert.equal(result.foreground,true);
  assert.equal(result.bounds.x,-1928);
  assert.equal(t.calls.filter(c=>c[1]==='inspect').length,1);
  await assert.rejects(inspectPhysicalRift(target,fakes({isForeground:false})),{code:'NOT_FOREGROUND'});
  await assert.rejects(inspectPhysicalRift(target,fakes({className:'VMUIFrame'})),{code:'WRONG_TARGET'});
  await assert.rejects(inspectPhysicalRift(target,fakes({height:28,width:160})),{code:'TARGET_NOT_VISIBLE'});
  await assert.rejects(inspectPhysicalRift(target,{...fakes(),getProcess:async()=>({...processRecord,startedUtc:'2026-11-05T19:01:11.123Z'})}),{code:'STALE_PROCESS'});
});

test('one synthetic action journals intent, holds both locks, sends exact sequence once, and blocks any new ID',async()=>{
  const root=await temp();
  let sent=0;
  const sender=async(request)=>{
    sent++;
    assert.deepEqual(Array.from(request.sequence),['Enter','/reloadui','Enter']);
    assert.equal(request.pid,target.pid);assert.equal(request.hwnd,target.hwnd);
    const names=await readdir(root);
    assert(names.includes('desktop-turn-admission.lock'));
    assert(names.includes('desktop-input-turn.lock'));
    assert(names.includes('physical-rift-reloadui-singleton.intent.json'));
    return {submitted:true,sequenceCount:3,targetPid:target.pid,targetHwnd:target.hwnd,senderSessionId:2};
  };
  const result=await executePhysicalReloadOnce(target,{...fakes(),sender,root});
  assert.equal(result.ok,true);
  assert.equal(result.verified,false);
  assert.equal(sent,1);
  const names=await readdir(root);
  assert(!names.includes('desktop-input-turn.lock'));
  assert(!names.includes('desktop-turn-admission.lock'));
  assert(names.includes('physical-rift-reloadui-singleton.intent.json'));
  assert(names.includes('physical-rift-reloadui-'+target.requestId+'.receipt.json'));
  const receipt=JSON.parse(await readFile(path.join(root,'physical-rift-reloadui-'+target.requestId+'.receipt.json'),'utf8'));
  assert.equal(receipt.submitted,true);assert.equal(receipt.verified,false);
  const replay=await executePhysicalReloadOnce(target,{...fakes(),sender,root});
  assert.equal(replay.replayed,true);assert.equal(sent,1);
  await assert.rejects(executePhysicalReloadOnce({...target,requestId:'physical_rift_reload_test002'},
    {...fakes(),sender,root}),{code:'ACTION_RECOVERY_REQUIRED'});
});

test('quarantine veto and foreign desktop turn prevent synthetic sender',async()=>{
  let sent=0;
  const sender=async()=>{sent++;return {submitted:true,sequenceCount:3,targetPid:target.pid,targetHwnd:target.hwnd,senderSessionId:2};};
  const root=await temp();
  await writeFile(path.join(root,'desktop-turn-quarantine-example.json'),'{}');
  await assert.rejects(executePhysicalReloadOnce(target,{...fakes(),sender,root}),{code:'UI_TURN_RECOVERY_REQUIRED'});
  assert.equal(sent,0);
  const root2=await temp();
  await writeFile(path.join(root2,'desktop-input-turn.lock'),'foreign');
  await assert.rejects(executePhysicalReloadOnce(target,{...fakes(),sender,root:root2}),{code:'UI_TURN_BUSY'});
  assert.equal(sent,0);
  assert.equal(await readFile(path.join(root2,'desktop-input-turn.lock'),'utf8'),'foreign');
});

test('uncertain native action retains intent and GUI turn lock; later attempt does not resend',async()=>{
  const root=await temp();
  let sent=0;
  const sender=async()=>{sent++;throw new Error('SIMULATED_SENDER_FAILURE');};
  await assert.rejects(executePhysicalReloadOnce(target,{...fakes(),sender,root}),/SIMULATED_SENDER_FAILURE/);
  const names=await readdir(root);
  assert(names.includes('physical-rift-reloadui-singleton.intent.json'));
  assert(names.includes('desktop-input-turn.lock'));
  const sidecar=names.find(n=>n.startsWith('desktop-turn-quarantine-')&&n.endsWith('.json'));
  assert(sidecar,'uncertain action must seal a linked quarantine sidecar');
  const quarantine=JSON.parse(await readFile(path.join(root,sidecar),'utf8'));
  assert.equal(quarantine.requestId,target.requestId);
  assert.equal(quarantine.automaticRetryAllowed,false);
  assert(!names.includes('desktop-turn-admission.lock'));
  await assert.rejects(executePhysicalReloadOnce(target,{...fakes(),sender,root}),{code:'UI_TURN_RECOVERY_REQUIRED'});
  assert.equal(sent,1);
});


test('staged WinApp sender sends immutable three phases with fresh visual and foreground checks',async()=>{
  const base=fakes();
  const keyCalls=[];
  const runner=async(args)=>{
    if(args[1]==='send-keys'){
      keyCalls.push(args);
      return JSON.stringify({keys:args[2],via:'send-input',actionCount:1,
        target:null,hwnd:target.hwnd,warnings:[]});
    }
    return await base.runner(args);
  };
  const sender=createGuardedWinappSender({runner,getProcess:base.getProcess,
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',pid:target.pid,hwnd:target.hwnd,
    startedUtc:target.startedUtc,sessionId:2,capturedUtc:new Date().toISOString(),
    imageSha256:'a'.repeat(64)}});
  const result=await sender({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']});
  assert.equal(result.submitted,true);
  assert.equal(result.sequenceCount,3);
  assert.equal(result.senderSessionId,2);
  assert.deepEqual(keyCalls,[
    ['ui','send-keys','enter','-w','462734','--via','send-input','--json'],
    ['ui','send-keys','/reloadui','-w','462734','--via','send-input','--verbatim','--json'],
    ['ui','send-keys','enter','-w','462734','--via','send-input','--json'],
  ]);
  assert(base.calls.filter(c=>c[1]==='list-windows').length>=6,
    'window must be reidentified both before and after each gate');
});

test('staged sender refuses missing chat proof, wrong target, and uncertain native input',async()=>{
  assert.throws(()=>createGuardedWinappSender(),{code:'CHAT_STATE_GATE_REQUIRED'});
  const base=fakes();
  const sender=createGuardedWinappSender({runner:base.runner,getProcess:base.getProcess,
    chatClosedEvidence:{...{confirmed:true,state:'chat-closed-empty',pid:target.pid,hwnd:target.hwnd,
    startedUtc:target.startedUtc,sessionId:2,capturedUtc:new Date().toISOString(),
    imageSha256:'b'.repeat(64)},confirmed:false}});
  await assert.rejects(sender({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']}),
    {code:'CHAT_STATE_UNVERIFIED'});
  await assert.rejects(sender({...target,sessionId:2,sequence:['Enter','/quit','Enter']}),
    {code:'INVALID_ACTION_SEQUENCE'});
  const bad=fakes({isForeground:false});
  const forbidden=createGuardedWinappSender({runner:bad.runner,getProcess:bad.getProcess,
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',pid:target.pid,hwnd:target.hwnd,
    startedUtc:target.startedUtc,sessionId:2,capturedUtc:new Date().toISOString(),
    imageSha256:'c'.repeat(64)}});
  await assert.rejects(forbidden({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']}),
    {code:'NOT_FOREGROUND'});
  const uncertain=createGuardedWinappSender({
    getProcess:base.getProcess,
    runner:async(args)=>args[1]==='send-keys'
      ? JSON.stringify({keys:'wrong',via:'send-input',actionCount:1,hwnd:target.hwnd,warnings:[]})
      : base.runner(args),
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',pid:target.pid,hwnd:target.hwnd,
    startedUtc:target.startedUtc,sessionId:2,capturedUtc:new Date().toISOString(),
    imageSha256:'d'.repeat(64)}});
  await assert.rejects(uncertain({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']}),
    {code:'ACTION_RECOVERY_REQUIRED'});
});


test('staged sender aborts after first key when RIFT loses foreground, never sends text or final Enter',async()=>{
  const base=fakes();
  let sent=0;
  const runner=async(args)=>{
    if(args[1]==='send-keys'){
      sent++;
      return JSON.stringify({keys:args[2],via:'send-input',actionCount:1,
        target:null,hwnd:target.hwnd,warnings:[]});
    }
    if(args[1]==='list-windows' && sent>=1)
      return JSON.stringify([{...windowRecord,isForeground:false}]);
    return await base.runner(args);
  };
  const sender=createGuardedWinappSender({runner,getProcess:base.getProcess,
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',pid:target.pid,hwnd:target.hwnd,
    startedUtc:target.startedUtc,sessionId:2,capturedUtc:new Date().toISOString(),
    imageSha256:'e'.repeat(64)}});
  await assert.rejects(sender({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']}),
    {code:'NOT_FOREGROUND'});
  assert.equal(sent,1,'must never type /reloadui into a different foreground target');
});


test('staged sender refuses stale chat screenshot and never injects first key',async()=>{
  const base=fakes();
  let sent=0;
  const runner=async(args)=>{
    if(args[1]==='send-keys') { sent++; throw new Error('Unexpected input'); }
    return base.runner(args);
  };
  const sender=createGuardedWinappSender({runner,getProcess:base.getProcess,
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',
      pid:target.pid,hwnd:target.hwnd,startedUtc:target.startedUtc,sessionId:2,
      capturedUtc:new Date(Date.now()-50000).toISOString(),imageSha256:'f'.repeat(64)}});
  await assert.rejects(sender({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']}),
    {code:'CHAT_STATE_UNVERIFIED'});
  assert.equal(sent,0);
});

test('no default sender means zero game input and no durable intent',async()=>{
  const root=await temp();
  await assert.rejects(executePhysicalReloadOnce(target,{...fakes(),root}),{code:'NO_VALIDATED_INPUT_TRANSPORT'});
  assert.deepEqual(await readdir(root),[]);
});

test('CLI modes require explicit flags and a captured visual attestation for live execution',()=>{
  const execute=[...BASE,'--execute-once','--screenshot-request-id','chat_capture_001',
    '--chat-visual-attestation','chat-closed-empty'];
  const parsed=parseReloadRequest(execute);
  assert.equal(parsed.executeOnce,true);
  assert.equal(parsed.screenshotRequestId,'chat_capture_001');
  assert.equal(parsed.chatVisualAttestation,'chat-closed-empty');
  assert.equal(parseReloadRequest([...BASE,'--focus-only']).focusOnly,true);
  assert.throws(()=>parseReloadRequest([...execute,'--focus-only']),{code:'INVALID_ARGUMENTS'});
  assert.throws(()=>parseReloadRequest([...BASE,'--execute-once']),{code:'CHAT_STATE_GATE_REQUIRED'});
  assert.throws(()=>parseReloadRequest([...BASE,'--chat-visual-attestation','chat-closed-empty']),
    {code:'INVALID_ARGUMENTS'});
});

test('screenshot gate binds real receipt and PNG, rejects stale or corrupted input BEFORE any lock',async()=>{
  const root=await temp();
  const id='chat_capture_001';
  const imagePath=path.join(root,'capture-'+id+'.png');
  const metadataPath=path.join(root,'capture-'+id+'.json');
  const bytes=Buffer.alloc(12000,0x71);
  const sha=createHash('sha256').update(bytes).digest('hex');
  const at=new Date().toISOString();
  const request={...target,executeOnce:true,screenshotRequestId:id,
    chatVisualAttestation:'chat-closed-empty'};
  const receipt={schemaVersion:1,requestId:id,pid:target.pid,hwnd:target.hwnd,
    process:'rift_x64',expectedClass:'TWNClientFramework',title:'RIFT',
    capturedUtc:at,imagePath,width:1920,height:1032,sizeBytes:bytes.length,
    sha256:sha,inputInjected:false};
  await writeFile(imagePath,bytes);
  await writeFile(metadataPath,JSON.stringify(receipt)+'\n');
  const getProcess=async()=>({...processRecord});
  const result=await readVerifiedChatEvidence(request,{root,getProcess,now:()=>Date.parse(at)+1000});
  assert.equal(result.imageSha256,sha);
  assert.equal(result.state,'chat-closed-empty');
  assert.equal(result.sessionId,2);
  await assert.rejects(readVerifiedChatEvidence(request,{root,getProcess,
    now:()=>Date.parse(at)+16000}),{code:'CHAT_STATE_UNVERIFIED'});
  assert.deepEqual((await readdir(root)).sort(),['capture-'+id+'.json','capture-'+id+'.png']);
  await writeFile(imagePath,Buffer.alloc(12000,0x72));
  await assert.rejects(readVerifiedChatEvidence(request,{root,getProcess,
    now:()=>Date.parse(at)+1000}),{code:'CHAT_STATE_UNVERIFIED'});
  await writeFile(imagePath,bytes);
  await writeFile(metadataPath,JSON.stringify({...receipt,imagePath:undefined})+'\n');
  await assert.rejects(readVerifiedChatEvidence(request,{root,getProcess,
    now:()=>Date.parse(at)+1000}),{code:'CHAT_STATE_UNVERIFIED'});
});

test('focus-only dynamically selects exact RIFT UIA root, sends ZERO keys, and journals once',async()=>{
  const root=await temp();
  let focused=false;
  let focusCalls=0;
  const base=fakes();
  const runner=async(args)=>{
    if(args[1]==='list-windows')
      return JSON.stringify([{...windowRecord,isForeground:focused}]);
    if(args[1]==='focus') {
      focusCalls++;
      assert.deepEqual(args,['ui','focus','win-rift-5475','-w','462734','--json']);
      focused=true;
      return JSON.stringify({hwnd:target.hwnd});
    }
    if(args[1]==='send-keys') throw new Error('FOCUS_MODE_MUST_NOT_INJECT_KEYS');
    return base.runner(args);
  };
  const request={...target,requestId:'physical_focus_test001',focusOnly:true};
  const result=await executePhysicalFocusOnce(request,{runner,getProcess:base.getProcess,root});
  assert.equal(result.ok,true);
  assert.equal(result.focused,true);
  assert.equal(result.inputSubmitted,false);
  assert.equal(focusCalls,1);
  const entries=await readdir(root);
  assert(!entries.includes('desktop-input-turn.lock'));
  assert(!entries.includes('desktop-turn-admission.lock'));
  assert(entries.includes('physical-rift-focus-'+request.requestId+'.intent.json'));
  assert(entries.includes('physical-rift-focus-'+request.requestId+'.receipt.json'));
  const replay=await executePhysicalFocusOnce(request,{runner,getProcess:base.getProcess,root});
  assert.equal(replay.replayed,true);
  assert.equal(focusCalls,1);
});

test('uncertain focus retains linked quarantine and never performs a keyboard action',async()=>{
  const root=await temp();
  const base=fakes();
  let focusCalls=0;
  const runner=async(args)=>{
    if(args[1]==='list-windows') return JSON.stringify([{...windowRecord,isForeground:false}]);
    if(args[1]==='focus') { focusCalls++; return JSON.stringify({hwnd:target.hwnd}); }
    if(args[1]==='send-keys') throw new Error('FORBIDDEN_KEY');
    return base.runner(args);
  };
  const request={...target,requestId:'physical_focus_test002',focusOnly:true};
  await assert.rejects(executePhysicalFocusOnce(request,
    {runner,getProcess:base.getProcess,root}),{code:'NOT_FOREGROUND'});
  assert.equal(focusCalls,1);
  const entries=await readdir(root);
  assert(entries.includes('desktop-input-turn.lock'));
  assert(entries.some(n=>n.startsWith('desktop-turn-quarantine-')));
  assert(entries.includes('physical-rift-focus-'+request.requestId+'.intent.json'));
  assert(!entries.includes('physical-rift-focus-'+request.requestId+'.receipt.json'));
});

test('sender accepts fresh UIA root reply target, requires actionCount one, and waits 500ms',async()=>{
  const base=fakes();
  const waits=[];
  let sends=0;
  const sender=createGuardedWinappSender({
    getProcess:base.getProcess,
    settle:async(ms)=>{waits.push(ms);},
    runner:async(args)=>{
      if(args[1]==='send-keys') {
        sends++;
        return JSON.stringify({keys:args[2],via:'send-input',actionCount:1,
          target:'win-rift-5475',hwnd:target.hwnd,warnings:[]});
      }
      return base.runner(args);
    },
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',
      pid:target.pid,hwnd:target.hwnd,startedUtc:target.startedUtc,sessionId:2,
      capturedUtc:new Date().toISOString(),imageSha256:'a'.repeat(64)},
  });
  const result=await sender({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']});
  assert.equal(result.submitted,true);
  assert.equal(sends,3);
  assert.deepEqual(waits,[500]);
  const bad=createGuardedWinappSender({
    getProcess:base.getProcess,settle:async()=>{},
    runner:async(args)=>args[1]==='send-keys'
      ? JSON.stringify({keys:args[2],via:'send-input',actionCount:2,
        target:'win-rift-5475',hwnd:target.hwnd,warnings:[]})
      : base.runner(args),
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',
      pid:target.pid,hwnd:target.hwnd,startedUtc:target.startedUtc,sessionId:2,
      capturedUtc:new Date().toISOString(),imageSha256:'b'.repeat(64)},
  });
  await assert.rejects(bad({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']}),
    {code:'ACTION_RECOVERY_REQUIRED'});
});

test('window-target label is accepted only with exact HWND; unrelated label still fails closed',async()=>{
  const base=fakes();
  const proof={confirmed:true,state:'chat-closed-empty',pid:target.pid,hwnd:target.hwnd,
    startedUtc:target.startedUtc,sessionId:2,capturedUtc:new Date().toISOString(),
    imageSha256:'c'.repeat(64)};
  const exact=createGuardedWinappSender({getProcess:base.getProcess,settle:async()=>{},
    runner:async(args)=>args[1]==='send-keys'
      ? JSON.stringify({keys:args[2],via:'send-input',actionCount:1,
        target:'Window',hwnd:target.hwnd,warnings:[]})
      : base.runner(args),
    chatClosedEvidence:proof});
  const passed=await exact({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']});
  assert.equal(passed.submitted,true);
  const unrelated=createGuardedWinappSender({getProcess:base.getProcess,settle:async()=>{},
    runner:async(args)=>args[1]==='send-keys'
      ? JSON.stringify({keys:args[2],via:'send-input',actionCount:1,
        target:'OtherWindow',hwnd:target.hwnd,warnings:[]})
      : base.runner(args),
    chatClosedEvidence:proof});
  await assert.rejects(unrelated({...target,sessionId:2,sequence:['Enter','/reloadui','Enter']}),
    {code:'ACTION_RECOVERY_REQUIRED'});
});

function integratedBackgroundFixture({retainBackground=false,dropAfterFirst=false,wrongFocusHwnd=false}={}) {
  const base=fakes();
  const calls=[];
  let foreground=false,keys=0,focus=0;
  const runner=async(args)=>{
    calls.push(args);
    if(args[1]==='list-windows')
      return JSON.stringify([{...windowRecord,isForeground:foreground}]);
    if(args[1]==='focus') {
      focus++;
      assert.deepEqual(args,['ui','focus','win-rift-5475','-w',String(target.hwnd),'--json']);
      if(!retainBackground)foreground=true;
      return JSON.stringify({hwnd:wrongFocusHwnd?target.hwnd+1:target.hwnd});
    }
    if(args[1]==='send-keys') {
      keys++;
      if(dropAfterFirst&&keys===1)foreground=false;
      return JSON.stringify({keys:args[2],via:'send-input',actionCount:1,
        target:'Window',hwnd:target.hwnd,warnings:[]});
    }
    return base.runner(args);
  };
  const sender=createGuardedWinappSender({runner,getProcess:base.getProcess,settle:async()=>{},
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',pid:target.pid,
      hwnd:target.hwnd,startedUtc:target.startedUtc,sessionId:2,
      capturedUtc:new Date().toISOString(),imageSha256:'e'.repeat(64)}});
  return {runner,sender,getProcess:base.getProcess,calls,
    get state(){return {foreground,keys,focus};}};
}

test('integrated execute-once focuses background game inside fsynced exclusive reload intent then sends three keys',async()=>{
  const fx=integratedBackgroundFixture();
  const root=await temp();
  const wrapped=async(input)=>{
    const names=await readdir(root);
    assert(names.includes('desktop-turn-admission.lock'));
    assert(names.includes('desktop-input-turn.lock'));
    const intent=JSON.parse(await readFile(path.join(root,'physical-rift-reloadui-singleton.intent.json'),'utf8'));
    assert.deepEqual(intent.plannedActions,['uia-root-focus','Enter','/reloadui','Enter']);
    assert.equal(intent.target.rootSelector,'win-rift-5475');
    return fx.sender(input);
  };
  const request={...target,executeOnce:true};
  const result=await executePhysicalReloadOnce(request,{runner:fx.runner,getProcess:fx.getProcess,
    sender:wrapped,root});
  assert.equal(result.submitted,true);
  assert.deepEqual(fx.state,{foreground:true,keys:3,focus:1});
  const actions=fx.calls.filter(a=>a[1]==='focus'||a[1]==='send-keys');
  assert.deepEqual(actions.map(a=>a[1]),['focus','send-keys','send-keys','send-keys']);
  assert.deepEqual(actions.filter(a=>a[1]==='send-keys').map(a=>a[2]),
    ['enter','/reloadui','enter']);
  const replay=await executePhysicalReloadOnce(request,{runner:fx.runner,getProcess:fx.getProcess,
    sender:wrapped,root});
  assert.equal(replay.replayed,true);
  assert.deepEqual(fx.state,{foreground:true,keys:3,focus:1});
});

test('integrated focus failure quarantines after intent, injects zero keys and never retries',async()=>{
  for(const config of [{retainBackground:true},{wrongFocusHwnd:true}]) {
    const fx=integratedBackgroundFixture(config);
    const root=await temp();
    await assert.rejects(executePhysicalReloadOnce({...target,executeOnce:true},
      {runner:fx.runner,getProcess:fx.getProcess,sender:fx.sender,root}),
      {code:config.wrongFocusHwnd?'ACTION_RECOVERY_REQUIRED':'NOT_FOREGROUND'});
    assert.equal(fx.state.focus,1);
    assert.equal(fx.state.keys,0);
    const files=await readdir(root);
    assert(files.includes('desktop-input-turn.lock'));
    assert(files.includes('physical-rift-reloadui-singleton.intent.json'));
    assert(files.some(name=>name.startsWith('desktop-turn-quarantine-')));
    await assert.rejects(executePhysicalReloadOnce({...target,executeOnce:true},
      {runner:fx.runner,getProcess:fx.getProcess,sender:fx.sender,root}),
      {code:'UI_TURN_RECOVERY_REQUIRED'});
    assert.equal(fx.state.focus,1);
  }
});

test('integrated focus never retries or types command after foreground loss following first Enter',async()=>{
  const fx=integratedBackgroundFixture({dropAfterFirst:true});
  const root=await temp();
  await assert.rejects(executePhysicalReloadOnce({...target,executeOnce:true},
    {runner:fx.runner,getProcess:fx.getProcess,sender:fx.sender,root}),{code:'NOT_FOREGROUND'});
  assert.equal(fx.state.focus,1);
  assert.equal(fx.state.keys,1);
  const files=await readdir(root);
  assert(files.includes('desktop-input-turn.lock'));
  assert(files.some(name=>name.startsWith('desktop-turn-quarantine-')));
});

test('integrated reload rejects stale post-intent UIA root without focusing or typing',async()=>{
  const fx=integratedBackgroundFixture();
  let inspects=0;
  const runner=async(args)=>{
    if(args[1]==='inspect' && ++inspects>=3) {
      const rootElement={...treeRecord.windows[0].elements[0],selector:'win-stale-root'};
      return JSON.stringify({windows:[{hwnd:target.hwnd,elements:[rootElement]}]});
    }
    return fx.runner(args);
  };
  const sender=createGuardedWinappSender({runner,getProcess:fx.getProcess,settle:async()=>{},
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',pid:target.pid,
      hwnd:target.hwnd,startedUtc:target.startedUtc,sessionId:2,
      capturedUtc:new Date().toISOString(),imageSha256:'d'.repeat(64)}});
  const root=await temp();
  await assert.rejects(executePhysicalReloadOnce({...target,executeOnce:true},
    {runner,getProcess:fx.getProcess,sender,root}),{code:'FOCUS_SELECTOR_UNAVAILABLE'});
  assert.equal(fx.state.focus,0);
  assert.equal(fx.state.keys,0);
  const entries=await readdir(root);
  assert(entries.includes('desktop-input-turn.lock'));
  assert(entries.some(name=>name.startsWith('desktop-turn-quarantine-')));
});

test('integrated reload treats explicit native focus failure as uncertain with zero keys',async()=>{
  const fx=integratedBackgroundFixture();
  const runner=async(args)=>args[1]==='focus'
    ? JSON.stringify({success:false,hwnd:target.hwnd,error:'Cannot focus'})
    : fx.runner(args);
  const sender=createGuardedWinappSender({runner,getProcess:fx.getProcess,settle:async()=>{},
    chatClosedEvidence:{confirmed:true,state:'chat-closed-empty',pid:target.pid,
      hwnd:target.hwnd,startedUtc:target.startedUtc,sessionId:2,
      capturedUtc:new Date().toISOString(),imageSha256:'d'.repeat(64)}});
  const root=await temp();
  await assert.rejects(executePhysicalReloadOnce({...target,executeOnce:true},
    {runner,getProcess:fx.getProcess,sender,root}),{code:'ACTION_RECOVERY_REQUIRED'});
  assert.equal(fx.state.keys,0);
  const entries=await readdir(root);
  assert(entries.includes('desktop-input-turn.lock'));
  assert(entries.some(name=>name.startsWith('desktop-turn-quarantine-')));
});

