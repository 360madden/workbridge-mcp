#!/usr/bin/env node
// OFFLINE ONLY: physical-RIFT RRECollector Retry evidence gate and no-input journal.
// No native sender, focus, mouse, keyboard, screenshot, reload or restart is reachable.
import {createHash,randomUUID} from 'node:crypto';
import {lstat,realpath,readFile,open,unlink,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {withDesktopAdmission} from '../../../../scripts/desktop-turn-admission.mjs';

const ROOT=fileURLToPath(new URL('../../../../',import.meta.url));
const EVIDENCE=path.join(ROOT,'.tools','desktop-evidence');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const FRAME_SOURCE='win32-DwmGetWindowAttribute-DWMWA_EXTENDED_FRAME_BOUNDS';
export const LIVE_REFUSAL='LIVE_DISABLED_PENDING_P3';
export class RetrySenderError extends Error {
  constructor(code,message){super(message);this.name='RetrySenderError';this.code=code;}
}
const stop=(code,message)=>{throw new RetrySenderError(code,message);};
const sha=(v)=>createHash('sha256').update(v).digest('hex');
const integer=Number.isSafeInteger;
const iso=(s)=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(s)&&Number.isFinite(Date.parse(s));
const rect=(r)=>r&&['x','y','width','height'].every(k=>integer(r[k]))&&r.width>0&&r.height>0;
const sameRect=(a,b)=>rect(a)&&rect(b)&&['x','y','width','height'].every(k=>a[k]===b[k]);
const nearRect=(a,b)=>rect(a)&&rect(b)&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<=1);
const sameProcess=(p,t)=>p?.pid===t.pid&&p?.sessionId===t.sessionId&&iso(p?.startedUtc)&&Math.abs(Date.parse(p.startedUtc)-Date.parse(t.startedUtc))<=1;
const winIdentity=(w,t)=>w?.pid===t.pid&&w?.hwnd===t.hwnd&&w?.process==='rift_x64'&&w?.title==='RIFT'&&w?.className==='TWNClientFramework'&&w?.ownerHwnd===0;

export function parseRetryArgs(argv){
  if(argv.some(s=>s==='--execute-once'||s==='--live'||s.startsWith('--execute-once=')||s.startsWith('--live=')))
    stop(LIVE_REFUSAL,'RIFT input disabled until P3 independent review and target-specific Joey approval');
  const opts=new Set();
  for(const a of argv)if(a.startsWith('--')){const k=a.split('=')[0];if(opts.has(k))stop('INVALID_ARGUMENTS','Duplicate flag');opts.add(k);}
  let v;
  try{({values:v}=parseArgs({args:argv,strict:true,allowPositionals:false,
    options:{'preflight-only':{type:'string'},'journal-offline-once':{type:'string'}}}));}
  catch{stop('INVALID_ARGUMENTS','Only offline preflight or journal modes supported');}
  const n=Number(v['preflight-only']!==undefined)+Number(v['journal-offline-once']!==undefined);
  if(n!==1)stop('MODE_REQUIRED','Exactly one offline mode required');
  const mode=v['preflight-only']!==undefined?'preflight':'journal';
  const envelopePath=mode==='preflight'?v['preflight-only']:v['journal-offline-once'];
  if(!path.isAbsolute(envelopePath))stop('INVALID_ARGUMENTS','Absolute witness path required');
  return {mode,envelopePath};
}

async function boundedFile(filename,min,max){
  let stat,canon;
  try{[stat,canon]=await Promise.all([lstat(filename),realpath(filename)]);}
  catch{stop('EVIDENCE_UNAVAILABLE','Required evidence unavailable');}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<min||stat.size>max||
      canon.toLowerCase()!==path.resolve(filename).toLowerCase())
    stop('EVIDENCE_IDENTITY_INVALID','Evidence must be bounded plain file with unique identity');
  return stat;
}
async function jsonFile(p,max=32768){
  await boundedFile(p,2,max);
  try{const v=JSON.parse(await readFile(p,'utf8'));if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}
  catch{stop('EVIDENCE_INVALID_JSON','Malformed evidence JSON');}
}
function pngInfo(bytes){
  if(bytes.length<45||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
     bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||
     !bytes.includes(Buffer.from('IEND'),29))stop('INVALID_PNG','PNG signature/chunks missing');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<256||width>10000||height<100||height>10000)stop('INVALID_PNG','Invalid PNG dimensions');
  return {width,height,sizeBytes:bytes.length,sha256:sha(bytes)};
}

/* DWM extended-frame PNG origin is NOT outer HWND or Win32 client origin.
 * Actual observed example: outer (-1928,-2) 1936x1048,
 * DWM frame (-1920,6) 1920x1032, client origin (-1920,29) 1920x1009.
 * Native C# dry-run must independently revalidate this proof before P3.
 */
export function planDwmRetryOffline(e,nowUtc=new Date().toISOString()){
  const t=e?.target,w=e?.windowAfter,c=e?.capture,m=e?.coordinateMapping;
  if(!t||!integer(t.pid)||t.pid<1||!integer(t.hwnd)||t.hwnd<1||
     !iso(t.startedUtc)||!integer(t.sessionId)||t.sessionId<1||
     !sameProcess(e.processBefore,t)||!sameProcess(e.processAfter,t))
    stop('PROCESS_IDENTITY_UNVERIFIED','Pinned PID/HWND/startUTC/session witness missing');
  if(!winIdentity(e.windowBefore,t)||!winIdentity(w,t)||
     !nearRect(e.windowBefore,w)||w.width<700||w.height<500||
     w.isVisible!==true||w.isForeground!==true||
     e.uiaRootAfter?.hwnd!==t.hwnd||e.uiaRootAfter?.className!=='TWNClientFramework'||
     e.uiaRootAfter?.isEnabled!==true||e.uiaRootAfter?.isOffscreen!==false||
     !nearRect(e.uiaRootAfter,w))
    stop('STALE_WINDOW','Physical RIFT foreground/geometry/UIA changed');
  if(!c||c.pid!==t.pid||c.hwnd!==t.hwnd||c.process!=='rift_x64'||
     c.expectedClass!=='TWNClientFramework'||c.title!=='RIFT'||
     !ID.test(c.requestId??'')||!SHA.test(c.sha256??'')||
     !iso(c.capturedUtc)||!iso(nowUtc)||c.inputInjected!==false||
     c.imageBytesVerified!==true||c.imageSha256Verified!==true||
     c.imageDimensionsVerified!==true||Date.parse(c.capturedUtc)<Date.parse(t.startedUtc))
    stop('CAPTURE_UNVERIFIED','Receipt-backed screenshot identity missing');
  const age=Date.parse(nowUtc)-Date.parse(c.capturedUtc);
  if(age< -1000||age>30000)stop('CAPTURE_STALE','Capture older than 30 seconds or future');
  if(m?.mode!=='dwm-extended-frame-physical'||m.source!==FRAME_SOURCE||
     m.dpiAwareness!=='per-monitor-v2'||!integer(m.dpi)||m.dpi<72||m.dpi>480||
     !iso(m.observedUtc)||Date.parse(m.observedUtc)<Date.parse(c.capturedUtc)-1000||
     Date.parse(m.observedUtc)>Date.parse(nowUtc)+1000||
     !sameRect(m.outerWindow,w)||!rect(m.dwmFrame)||
     !m.clientOrigin||!integer(m.clientOrigin.x)||!integer(m.clientOrigin.y)||
     !m.clientSize||!integer(m.clientSize.width)||!integer(m.clientSize.height)||
     m.clientSize.width<500||m.clientSize.height<400||
     m.dwmFrame.width!==c.width||m.dwmFrame.height!==c.height||
     m.dwmFrame.x<w.x||m.dwmFrame.y<w.y||
     m.dwmFrame.x+m.dwmFrame.width>w.x+w.width||
     m.dwmFrame.y+m.dwmFrame.height>w.y+w.height||
     m.clientOrigin.x<m.dwmFrame.x||m.clientOrigin.y<m.dwmFrame.y||
     m.clientOrigin.x+m.clientSize.width>m.dwmFrame.x+m.dwmFrame.width||
     m.clientOrigin.y+m.clientSize.height>m.dwmFrame.y+m.dwmFrame.height||
     e.desktop?.coordinateSpace!=='physical-virtual-screen-pixels'||
     e.desktop?.pointerPositionVerified!==true||e.dpiAwareness!=='per-monitor-v2')
    stop('DWM_MAPPING_UNVERIFIED','Exact native DWM/client/DPI physical-pixel transform required');
  const visual=e.visual,r=visual?.rect;
  if(visual?.captureRequestId!==c.requestId||visual?.captureSha256!==c.sha256||
     visual?.attestation!=='rrecollector-0.4.11-retry-button-visible'||
     !r||!['left','top','right','bottom'].every(k=>integer(r[k])))
    stop('VISUAL_ATTESTATION_REQUIRED','Hash-bound human Retry ROI missing');
  if(r.left<10||r.top<32||r.right>c.width-10||r.bottom>c.height-10||
     r.right-r.left<35||r.right-r.left>120||r.bottom-r.top<18||r.bottom-r.top>50)
    stop('UNSAFE_BUTTON_RECT','Retry ROI must be small, visible, inside PNG');
  const x=m.dwmFrame.x+Math.floor((r.left+r.right)/2);
  const y=m.dwmFrame.y+Math.floor((r.top+r.bottom)/2);
  if(x<=m.dwmFrame.x||x>=m.dwmFrame.x+m.dwmFrame.width||
     y<=m.dwmFrame.y||y>=m.dwmFrame.y+m.dwmFrame.height)
    stop('OUT_OF_DWM_FRAME','Planned point outside native DWM frame');
  return Object.freeze({kind:'physical-rift-retry-DWM-OFFLINE-PLAN',
    executable:false,liveAuthorized:false,target:{...t},
    captureRequestId:c.requestId,captureSha256:c.sha256,
    sourceDwmRect:{...m.dwmFrame},virtualScreenPoint:{x,y},
    proposedTransport:'FlaUI.Core.Input.Mouse.Click(Point)',
    requiredNextGate:'P3 independent review and target-specific Joey approval'});
}

export async function inspectRetryEvidence(envelopePath,{evidenceRoot=EVIDENCE,nowUtc=new Date().toISOString()}={}){
  const root=path.resolve(evidenceRoot),witness=await jsonFile(envelopePath);
  const id=witness?.capture?.requestId;
  if(!ID.test(id??'')||path.resolve(envelopePath).toLowerCase()!==
     path.join(root,'rift-retry-'+id+'.witness.json').toLowerCase())
    stop('EVIDENCE_PATH_INVALID','Witness must be in canonical fixed per-capture evidence path');
  const pngPath=path.join(root,'capture-'+id+'.png');
  if(witness.screenshotPngPath!==pngPath)stop('CAPTURE_PATH_CHANGED','PNG path not pinned');
  const receipt=await jsonFile(path.join(root,'capture-'+id+'.json'),65536);
  await boundedFile(pngPath,45,8*1024*1024);
  const png=pngInfo(await readFile(pngPath)),c=witness.capture;
  if(receipt.schemaVersion!==1||receipt.requestId!==id||
     receipt.pid!==c.pid||receipt.hwnd!==c.hwnd||
     receipt.process!==c.process||receipt.expectedClass!==c.expectedClass||
     receipt.title!==c.title||receipt.imagePath!==pngPath||
     receipt.inputInjected!==false||receipt.foregroundMayChange!==true||
     receipt.capturedUtc!==c.capturedUtc||
     receipt.sha256!==png.sha256||c.sha256!==png.sha256||
     receipt.width!==png.width||c.width!==png.width||
     receipt.height!==png.height||c.height!==png.height||
     receipt.sizeBytes!==png.sizeBytes)
    stop('CAPTURE_RECEIPT_MISMATCH','Workbridge receipt, PNG and witness disagree');
  const verified={...witness,capture:{...c,imageBytesVerified:true,
    imageSha256Verified:true,imageDimensionsVerified:true}};
  const plan=planDwmRetryOffline(verified,nowUtc);
  if(witness.plan!==undefined&&JSON.stringify(witness.plan)!==JSON.stringify(plan))
    stop('PLAN_MISMATCH','Supplied plan differs from independently recomputed DWM mapping');
  return {ok:true,status:'OFFLINE_DWM_PREFLIGHT_ONLY',readOnly:true,
    inputAttempted:false,plan,screenshotSha256:png.sha256,
    screenshotPixels:{width:png.width,height:png.height},
    nativeLiveVerificationStillRequired:true,humanRetryRoiReviewStillRequired:true};
}

async function exclusiveJson(filename,obj){
  const bytes=Buffer.from(JSON.stringify(obj)+'\n');
  if(bytes.length>4096)stop('JOURNAL_TOO_LARGE','Journal record too large');
  let f;try{f=await open(filename,'wx',0o600);}
  catch(e){if(e?.code==='EEXIST')stop('ACTION_RECOVERY_REQUIRED','One-shot already recorded: no replay');throw e;}
  try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
  return sha(bytes);
}
async function veto(root){
  if((await readdir(root)).some(s=>s.startsWith('desktop-turn-quarantine-')&&s.endsWith('.json')))
    stop('UI_TURN_RECOVERY_REQUIRED','Prior quarantine vetoes desktop turn');
}
async function createTurn(root,id,target){
  const filename=path.join(root,'desktop-input-turn.lock');
  const stamp={schemaVersion:1,kind:'workbridge.gui-turn',leaseId:randomUUID(),
    producer:'rift-retry-offline',requestId:id,owner:{pid:process.pid},
    target,acquiredUtc:new Date().toISOString()};
  const bytes=Buffer.from(JSON.stringify(stamp)+'\n');
  let f;try{f=await open(filename,'wx',0o600);}
  catch(e){if(e?.code==='EEXIST')stop('UI_TURN_BUSY','Desktop input-turn held');throw e;}
  const identity=await f.stat();
  try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
  return {filename,identity,stamp,bytes,hash:sha(bytes)};
}
async function releaseTurn(t){
  const a=await lstat(t.filename),bytes=await readFile(t.filename),b=await lstat(t.filename);
  if(!a.isFile()||a.isSymbolicLink()||a.nlink!==1||a.dev!==t.identity.dev||a.ino!==t.identity.ino||
     b.dev!==a.dev||b.ino!==a.ino||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs||
     sha(bytes)!==t.hash)stop('UI_TURN_RECOVERY_REQUIRED','Owner changed: retain desktop lock');
  await unlink(t.filename);
}
export async function journalOfflineRetryOnce(envelopePath,{evidenceRoot=EVIDENCE,nowUtc,testHookUnderTurn}={}){
  const root=path.resolve(evidenceRoot);
  await mkdir(root,{recursive:true});
  const result=await inspectRetryEvidence(envelopePath,{evidenceRoot:root,nowUtc});
  const id=result.plan.captureRequestId,lock=path.join(root,'desktop-input-turn.lock');
  return withDesktopAdmission(lock,{producer:'rift-retry-offline',requestId:id},async()=>{
    await veto(root);
    const singleton=path.join(root,'rift-retry-singleton.intent.json');
    const intent=path.join(root,'rift-retry-'+id+'.intent.json');
    const receipt=path.join(root,'rift-retry-'+id+'.receipt.json');
    for(const p of [singleton,intent,receipt]){
      const s=await lstat(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(s)stop('ACTION_RECOVERY_REQUIRED','One-shot record already present; no replay');
    }
    const turn=await createTurn(root,id,result.plan.target);
    let recorded=false,intentSha=null;
    try{
      await veto(root);
      // Offline synthetic fault injection only; never exposed by CLI or allowed in production root.
      if(testHookUnderTurn!==undefined){
        if(root===path.resolve(EVIDENCE)||typeof testHookUnderTurn!=='function')
          stop('TEST_HOOK_FORBIDDEN','Synthetic hook forbidden on real evidence directory');
        await testHookUnderTurn();
      }
      // Re-read independent screenshot bytes, receipt, DWM witness and timestamp
      // *under both held locks*; no stale pre-admission proof may reach a journal.
      const rechecked=await inspectRetryEvidence(envelopePath,{evidenceRoot:root,nowUtc});
      if(JSON.stringify(rechecked.plan)!==JSON.stringify(result.plan))
        stop('EVIDENCE_CHANGED_UNDER_LEASE','Evidence changed between initial and leased preflight');
      const obj={schemaVersion:1,kind:'workbridge.rift-retry-offline-intent',
        requestId:id,action:'offline-preflight-no-mouse',
        captureSha256:result.plan.captureSha256,point:result.plan.virtualScreenPoint,
        liveAuthorized:false,createdUtc:new Date().toISOString()};
      intentSha=await exclusiveJson(singleton,obj);recorded=true;
      await exclusiveJson(intent,obj);
      await exclusiveJson(receipt,{schemaVersion:1,kind:'workbridge.rift-retry-offline-receipt',
        requestId:id,intentSha256:intentSha,submitted:false,inputAttempted:false,
        status:'OFFLINE_ONLY_NO_INPUT',completedUtc:new Date().toISOString()});
      await releaseTurn(turn);
      return {ok:true,status:'OFFLINE_ONE_SHOT_JOURNALED',submitted:false,
        inputAttempted:false,replayed:false,plan:result.plan};
    }catch(error){
      if(recorded){
        try{await exclusiveJson(path.join(root,'desktop-turn-quarantine-'+turn.stamp.leaseId+'.json'),
          {schemaVersion:1,kind:'workbridge.gui-turn-quarantine',requestId:id,
          leaseId:turn.stamp.leaseId,ownerStampSha256:turn.hash,intentSha256:intentSha,
          reasonCode:'RIFT_RETRY_OFFLINE_JOURNAL_UNCERTAIN',automaticRetryAllowed:false,
          createdUtc:new Date().toISOString()});}
        catch{stop('ACTION_RECOVERY_REQUIRED','Quarantine seal uncertain; lock retained');}
      }else{await releaseTurn(turn);}
      throw error;
    }
  });
}
async function main(){
  try{
    const {mode,envelopePath}=parseRetryArgs(process.argv.slice(2));
    const result=mode==='preflight'?await inspectRetryEvidence(envelopePath):await journalOfflineRetryOnce(envelopePath);
    console.log(JSON.stringify(result));
  }catch(e){
    console.log(JSON.stringify({ok:false,code:e?.code??'OFFLINE_RETRY_FAILED',
      message:e?.message??'Unknown failure',inputAttempted:false}));
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
