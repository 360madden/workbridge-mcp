import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  parseCandidatesRequest, executePhysicalCandidatesPhase,
  createGuardedCandidatesSender, readVerifiedCandidatesEvidence,
} from '../scripts/physical-rift-candidates.mjs';

const target={pid:32156,hwnd:462734,startedUtc:'2026-11-05T19:01:10.123Z',
  requestId:'physical_rift_candidates_test001'};
const base=['--pid',String(target.pid),'--hwnd',String(target.hwnd),
  '--started-utc',target.startedUtc,'--request-id',target.requestId,
  '--confirm','one-physical-rift-candidates'];
const STAGE='chat-closed-empty-editor-absent';
const SUBMIT='rift-chat-focused-exact-candidates-editor-absent';
const stageRequest={...target,phase:'stage',executeOnce:true,
  screenshotRequestId:'capture_candidates_stage001',chatVisualAttestation:STAGE};
const submitRequest={...target,phase:'submit',executeOnce:false,
  screenshotRequestId:'capture_candidates_submit001',chatVisualAttestation:SUBMIT};
const identity={pid:target.pid,startedUtc:target.startedUtc,sessionId:2};
const windowBase={hwnd:target.hwnd,processId:target.pid,processName:'rift_x64',
  title:'RIFT',className:'TWNClientFramework',ownerHwnd:0,
  width:1936,height:1048};
const tree={windows:[{hwnd:target.hwnd,elements:[{type:'Window',name:'RIFT',
  className:'TWNClientFramework',isEnabled:true,isOffscreen:false,
  x:0,y:0,width:1936,height:1048,selector:'win-rift-5475'}]}]};
const evidence=(phase)=>({confirmed:true,state:phase==='stage'?STAGE:SUBMIT,
  ...target,sessionId:2,capturedUtc:new Date().toISOString(),
  imageSha256:'a'.repeat(64)});

async function temp(){return mkdtemp(path.join(os.tmpdir(),'wb-candidates-synthetic-'));}
function fixture({dropAfter=Infinity,wrongClass=false,wrongStart=false,failFocus=false}={}){
  let foreground=false,focusCalls=0;
  const sends=[],calls=[];
  const runner=async(args)=>{
    calls.push(args);
    if(args[0]==='--version')return 'WinApp CLI 0.7.1\n';
    if(args[1]==='inspect')return JSON.stringify(tree);
    if(args[1]==='list-windows')return JSON.stringify([{
      ...windowBase,className:wrongClass?'VMUIFrame':windowBase.className,
      isForeground:foreground}]);
    if(args[1]==='focus'){
      focusCalls++;
      if(failFocus)return JSON.stringify({success:false,error:'No focus'});
      foreground=true;return JSON.stringify({hwnd:target.hwnd});
    }
    if(args[1]==='send-keys'){
      sends.push(args);
      if(sends.length>=dropAfter)foreground=false;
      return JSON.stringify({via:'send-input',keys:args[2],hwnd:target.hwnd,
        actionCount:1,target:'Window',warnings:[]});
    }
    throw Error('Unexpected WinApp call '+args.join(' '));
  };
  const getProcess=async(pid)=>pid===process.pid
    ? {pid,sessionId:2,startedUtc:target.startedUtc}
    : {...identity,startedUtc:wrongStart?'2026-11-05T19:01:12.123Z':target.startedUtc};
  return {runner,getProcess,sends,calls,get focusCalls(){return focusCalls;},
    set foreground(value){foreground=value;}};
}
test('CLI parses exactly one stage or submit; no arbitrary command or hidden extra mode',()=>{
  assert.equal(parseCandidatesRequest([...base,'--stage-once','--screenshot-request-id',
    'capture_candidates_stage001','--chat-visual-attestation',STAGE]).phase,'stage');
  assert.equal(parseCandidatesRequest([...base,'--submit-once','--screenshot-request-id',
    'capture_candidates_submit001','--chat-visual-attestation',SUBMIT]).phase,'submit');
  assert.throws(()=>parseCandidatesRequest([...base,'--command','/quit']),{code:'INVALID_ARGUMENTS'});
  assert.throws(()=>parseCandidatesRequest([...base,'--stage-once']),{code:'CHAT_STATE_GATE_REQUIRED'});
  assert.throws(()=>parseCandidatesRequest([...base,'--stage-once','--submit-once']),
    {code:'MODE_REQUIRED'});
  assert.throws(()=>parseCandidatesRequest([...base,'--stage-once','--screenshot-request-id',
    'capture_candidates_stage001','--chat-visual-attestation',SUBMIT]),{code:'CHAT_STATE_GATE_REQUIRED'});
});
test('synthetic staging sends ONLY fixed Enter and verbatim literal; no final Enter; same exclusive GUI locks',async()=>{
  const root=await temp(),fx=fixture();
  const sender=createGuardedCandidatesSender({runner:fx.runner,getProcess:fx.getProcess,
    chatClosedEvidence:evidence('stage')});
  const wrapped=async(input)=>{
    const names=await readdir(root);
    assert(names.includes('desktop-input-turn.lock'));
    assert(names.includes('desktop-turn-admission.lock'));
    const intent=JSON.parse(await readFile(path.join(root,
      'physical-rift-candidates-stage-singleton.intent.json'),'utf8'));
    assert.deepEqual(intent.plannedActions,['uia-root-focus','Enter','/rre candidates']);
    assert.equal(intent.capture.visualAttestation,STAGE);
    return sender(input);
  };
  const result=await executePhysicalCandidatesPhase(stageRequest,{
    runner:fx.runner,getProcess:fx.getProcess,sender:wrapped,root,
    chatEvidence:evidence('stage')});
  assert.equal(result.inputSubmitted,false);
  assert.equal(result.status,'STAGED_UNSUBMITTED_REQUIRES_FRESH_VISUAL_REVIEW');
  assert.deepEqual(fx.sends,[
    ['ui','send-keys','enter','-w','462734','--via','send-input','--json'],
    ['ui','send-keys','/rre candidates','-w','462734','--via','send-input','--verbatim','--json'],
  ]);
  assert.equal(fx.focusCalls,1);
  const stageReceipt=JSON.parse(await readFile(path.join(root,
    'physical-rift-candidates-stage-'+target.requestId+'.receipt.json'),'utf8'));
  assert.equal(stageReceipt.staged,true);
  assert.equal(stageReceipt.submitted,false);
  assert.equal((await executePhysicalCandidatesPhase(stageRequest,{
    runner:fx.runner,getProcess:fx.getProcess,sender:wrapped,root,
    chatEvidence:evidence('stage')})).replayed,true);
  assert.equal(fx.sends.length,2,'no replay on repeated request');
  await assert.rejects(executePhysicalCandidatesPhase({
    ...stageRequest,requestId:'physical_rift_candidates_test002'},{
    runner:fx.runner,getProcess:fx.getProcess,sender:wrapped,root,
    chatEvidence:{...evidence('stage'),requestId:'physical_rift_candidates_test002'},
  }),{code:'ACTION_RECOVERY_REQUIRED'});
});
test('synthetic submit refuses absent native chat focus verifier BEFORE lock/input',async()=>{
  const root=await temp(),fx=fixture();
  await assert.rejects(executePhysicalCandidatesPhase(submitRequest,{
    runner:fx.runner,getProcess:fx.getProcess,
    sender:()=>{throw Error('No keys permitted');},
    chatEvidence:evidence('submit'),root,
  }),{code:'CHAT_FOCUS_BRIDGE_UNAVAILABLE'});
  assert.equal(fx.sends.length,0);
  assert.deepEqual(await readdir(root),[]);
});
test('uncertain synthetic stage sender failure retains intent and GUI lock, seals quarantine, never retries',async()=>{
  const root=await temp(),fx=fixture();let sends=0;
  const sender=async()=>{sends++;throw Error('Synthetic failure after first key');};
  await assert.rejects(executePhysicalCandidatesPhase(stageRequest,{
    runner:fx.runner,getProcess:fx.getProcess,sender,root,chatEvidence:evidence('stage'),
  }),/Synthetic failure/);
  const names=await readdir(root);
  assert(names.includes('physical-rift-candidates-stage-singleton.intent.json'));
  assert(names.includes('desktop-input-turn.lock'));
  assert(names.some(x=>x.startsWith('desktop-turn-quarantine-')));
  await assert.rejects(executePhysicalCandidatesPhase(stageRequest,{
    runner:fx.runner,getProcess:fx.getProcess,sender,root,chatEvidence:evidence('stage'),
  }),{code:'UI_TURN_RECOVERY_REQUIRED'});
  assert.equal(sends,1);
});
test('wrong physical process class/start and foreign GUI turn fail before any synthetic key',async()=>{
  for(const opts of [{wrongClass:true},{wrongStart:true}]){
    const fx=fixture(opts),root=await temp();
    const sender=createGuardedCandidatesSender({runner:fx.runner,getProcess:fx.getProcess,
      chatClosedEvidence:evidence('stage')});
    await assert.rejects(executePhysicalCandidatesPhase(stageRequest,{
      runner:fx.runner,getProcess:fx.getProcess,sender,root,chatEvidence:evidence('stage'),
    }),{code:opts.wrongClass?'WRONG_TARGET':'STALE_PROCESS'});
    assert.equal(fx.sends.length,0);
  }
  const fx=fixture(),root=await temp();
  await writeFile(path.join(root,'desktop-input-turn.lock'),'FOREIGN');
  await assert.rejects(executePhysicalCandidatesPhase(stageRequest,{
    runner:fx.runner,getProcess:fx.getProcess,sender:async()=>{},root,
    chatEvidence:evidence('stage'),
  }),{code:'UI_TURN_BUSY'});
  assert.equal(fx.sends.length,0);
});
test('sender rejects arbitrary sequence and stage foreground loss before literal',async()=>{
  const fx=fixture({dropAfter:1});
  const sender=createGuardedCandidatesSender({runner:fx.runner,getProcess:fx.getProcess,
    chatClosedEvidence:evidence('stage')});
  await assert.rejects(sender({...target,phase:'stage',sessionId:2,
    rootSelector:'win-rift-5475',allowInitialFocus:true,sequence:['Enter','/quit']}),
    {code:'INVALID_ACTION_SEQUENCE'});
  await assert.rejects(sender({...target,phase:'stage',sessionId:2,
    rootSelector:'win-rift-5475',allowInitialFocus:true,sequence:['Enter','/rre candidates']}),
    {code:'NOT_FOREGROUND'});
  assert.equal(fx.sends.length,1);
});
test('staged screenshot must be newer than stage and hash-pinned, never itself native focus proof',async()=>{
  const root=await temp(),id=submitRequest.screenshotRequestId;
  const imagePath=path.join(root,'capture-'+id+'.png');
  const at=new Date().toISOString(),bytes=Buffer.alloc(12000,0x51);
  const sha=createHash('sha256').update(bytes).digest('hex');
  const stageReceipt={requestId:target.requestId,completed:true,staged:true,
    stagedUtc:new Date(Date.parse(at)-1000).toISOString()};
  const metadata={schemaVersion:1,requestId:id,pid:target.pid,hwnd:target.hwnd,
    process:'rift_x64',title:'RIFT',expectedClass:'TWNClientFramework',inputInjected:false,
    imagePath,width:1920,height:1032,sizeBytes:bytes.length,sha256:sha,capturedUtc:at};
  await writeFile(imagePath,bytes);
  await writeFile(path.join(root,'capture-'+id+'.json'),JSON.stringify(metadata));
  const getProcess=async()=>({...identity});
  assert.equal((await readVerifiedCandidatesEvidence(submitRequest,
    {root,stageReceipt,getProcess})).state,SUBMIT);
  await assert.rejects(readVerifiedCandidatesEvidence(submitRequest,{
    root,stageReceipt:{...stageReceipt,stagedUtc:new Date(Date.parse(at)+1000).toISOString()},
    getProcess,
  }),{code:'CHAT_STATE_UNVERIFIED'});
  await writeFile(imagePath,Buffer.alloc(12000,0x50));
  await assert.rejects(readVerifiedCandidatesEvidence(submitRequest,{
    root,stageReceipt,getProcess,
  }),{code:'CHAT_STATE_UNVERIFIED'});
});

test('synthetic two-phase route submits exactly ONE final Enter only after trusted last-moment chat-focus proof',async()=>{
  const root=await temp(),fx=fixture(),proofCalls=[];
  const staging=createGuardedCandidatesSender({runner:fx.runner,getProcess:fx.getProcess,
    chatClosedEvidence:evidence('stage')});
  await executePhysicalCandidatesPhase(stageRequest,{
    root,runner:fx.runner,getProcess:fx.getProcess,sender:staging,
    chatEvidence:evidence('stage')});
  const before=fx.sends.map(x=>x[2]);
  assert.deepEqual(before,['enter','/rre candidates']);
  const afterCaptureEvidence=evidence('submit');
  const verifier=async(details)=>{proofCalls.push(details);return true;};
  const submitter=createGuardedCandidatesSender({runner:fx.runner,
    getProcess:fx.getProcess,chatClosedEvidence:afterCaptureEvidence,
    verifyNativeChatFocus:verifier});
  const accepted=await executePhysicalCandidatesPhase(submitRequest,{
    root,runner:fx.runner,getProcess:fx.getProcess,sender:submitter,
    chatEvidence:afterCaptureEvidence,verifyNativeChatFocus:verifier});
  assert.equal(accepted.inputSubmitted,true);
  assert.equal(proofCalls.length,2,'preflight and last-moment proof inside sender');
  assert.deepEqual(fx.sends.map(x=>x[2]),['enter','/rre candidates','enter']);
  const receipt=JSON.parse(await readFile(path.join(root,
    'physical-rift-candidates-submit-'+target.requestId+'.receipt.json'),'utf8'));
  assert.equal(receipt.submitted,true);
  assert.equal(receipt.verified,false);
  assert.equal((await executePhysicalCandidatesPhase(submitRequest,{
    root,runner:fx.runner,getProcess:fx.getProcess,sender:submitter,
    chatEvidence:afterCaptureEvidence,verifyNativeChatFocus:verifier})).replayed,true);
  assert.equal(fx.sends.length,3,'final Enter is never replayed');
});
test('synthetic last-moment chat-focus rejection retains submit quarantine with zero final Enter',async()=>{
  const root=await temp(),fx=fixture();
  const staging=createGuardedCandidatesSender({runner:fx.runner,getProcess:fx.getProcess,
    chatClosedEvidence:evidence('stage')});
  await executePhysicalCandidatesPhase(stageRequest,{
    root,runner:fx.runner,getProcess:fx.getProcess,sender:staging,
    chatEvidence:evidence('stage')});
  const submitter=createGuardedCandidatesSender({runner:fx.runner,
    getProcess:fx.getProcess,chatClosedEvidence:evidence('submit'),
    verifyNativeChatFocus:async()=>false});
  await assert.rejects(executePhysicalCandidatesPhase(submitRequest,{
    root,runner:fx.runner,getProcess:fx.getProcess,sender:submitter,
    chatEvidence:evidence('submit'),verifyNativeChatFocus:async()=>true,
  }),{code:'CHAT_FOCUS_UNVERIFIED'});
  assert.deepEqual(fx.sends.map(x=>x[2]),['enter','/rre candidates']);
  const entries=await readdir(root);
  assert(entries.includes('physical-rift-candidates-submit-singleton.intent.json'));
  assert(entries.includes('desktop-input-turn.lock'));
  assert(entries.some(x=>x.startsWith('desktop-turn-quarantine-')));
});
