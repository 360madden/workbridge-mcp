import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseReloadRequest, inspectPhysicalRift, executePhysicalReloadOnce,
} from '../scripts/physical-rift-reloadui.mjs';

const BASE = ['--pid','32156','--hwnd','462734','--started-utc','2026-11-05T19:01:10.123Z',
  '--request-id','physical_rift_reload_test001','--confirm','one-physical-rift-reloadui'];
const target = { pid:32156, hwnd:462734, startedUtc:'2026-11-05T19:01:10.123Z', requestId:'physical_rift_reload_test001' };
const processRecord = { pid:32156, startedUtc:target.startedUtc, sessionId:2 };
const windowRecord = { hwnd:462734, processId:32156, processName:'rift_x64', title:'RIFT',
  className:'TWNClientFramework', ownerHwnd:0, width:1936, height:1048, isForeground:true };
const treeRecord = { windows:[{hwnd:462734,elements:[{ type:'Window',name:'RIFT',
  className:'TWNClientFramework',isEnabled:true,isOffscreen:false,
  x:-1928,y:-2,width:1936,height:1048 }]}] };

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

test('no default sender means zero game input and no durable intent',async()=>{
  const root=await temp();
  await assert.rejects(executePhysicalReloadOnce(target,{...fakes(),root}),{code:'NO_VALIDATED_INPUT_TRANSPORT'});
  assert.deepEqual(await readdir(root),[]);
});
