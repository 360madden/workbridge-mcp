import test from 'node:test';
import assert from 'node:assert/strict';
import {assessNativeChatPhase, waitForNativeChatPhase, sendDisposableChatPhaseOnce} from '../scripts/chat-input-disposable-phase.mjs';

const shown = {stage:'shown',typedLength:0,chatOpen:false,matchedExpected:false};
const open = {stage:'opened',typedLength:0,chatOpen:true,matchedExpected:false};
const chars = Array.from({length:9},(_,i)=>({stage:'typed',typedLength:i+1,chatOpen:true,matchedExpected:i===8}));
const submit = {stage:'submitted',typedLength:9,chatOpen:true,matchedExpected:true};
const events = [shown,open,...chars,submit];

test('exact open, nine characters, submission each have independent stage predicates',()=>{
  assert.equal(assessNativeChatPhase([shown,open],'opened').satisfied,true);
  assert.equal(assessNativeChatPhase([shown,open,...chars],'typed').satisfied,true);
  assert.equal(assessNativeChatPhase(events,'submitted').satisfied,true);
  assert.equal(assessNativeChatPhase([shown],'opened').satisfied,false);
  assert.equal(assessNativeChatPhase([shown,open,...chars.slice(0,5)],'typed').satisfied,false);
});
test('late ninth character is polled, not interpreted as a failed send',async()=>{
  let now=0;let reads=0;let sends=0;let guards=0;
  const result=await sendDisposableChatPhaseOnce({
    phase:'typed',
    assertTarget:async()=>{guards++;},
    sendExactlyOnce:async()=>{sends++;return {status:'accepted'};},
    readEvents:async()=>{reads++;return [shown,open,...chars.slice(0,reads>=4?9:5)];},
    timeoutMs:3000,intervalMs:40,now:()=>now,sleep:async(ms)=>{now+=ms;},
  });
  assert.equal(sends,1);assert.equal(guards,1);assert.equal(reads,4);
  assert.equal(result.verified.typedCount,9);
});
test('timeout never resends the input phase',async()=>{
  let now=0;let sends=0;
  await assert.rejects(sendDisposableChatPhaseOnce({
    phase:'typed',assertTarget:async()=>{},sendExactlyOnce:async()=>{sends++;},
    readEvents:async()=>[shown,open,...chars.slice(0,8)],
    timeoutMs:100,intervalMs:50,now:()=>now,sleep:async(ms)=>{now+=ms;},
  }),{code:'PHASE_NOT_OBSERVED'});
  assert.equal(sends,1);
});
test('duplicate or unexpected native events fail closed',()=>{
  assert.throws(()=>assessNativeChatPhase([shown,open,open],'opened'),{code:'DUPLICATE_NATIVE_EVENT'});
  assert.throws(()=>assessNativeChatPhase([shown,open,{stage:'unexpected'}],'typed'),{code:'UNEXPECTED_NATIVE_EVENT'});
  assert.throws(()=>assessNativeChatPhase([shown,open,...chars,...chars.slice(-1)],'typed'),{code:'UNEXPECTED_NATIVE_EVENT'});
  assert.throws(()=>assessNativeChatPhase([shown,open,...chars,{...submit,matchedExpected:false}],'submitted'),{code:'WRONG_SUBMISSION'});
});
test('invalid phase/monitor and a target check failure prevent any send',async()=>{
  assert.throws(()=>assessNativeChatPhase([],'unknown'),{code:'INVALID_PHASE'});
  await assert.rejects(waitForNativeChatPhase({phase:'typed',readEvents:async()=>[],timeoutMs:99999}),{code:'INVALID_MONITOR'});
  let sends=0;
  await assert.rejects(sendDisposableChatPhaseOnce({
    phase:'opened',assertTarget:async()=>{throw Error('WRONG_WINDOW');},
    sendExactlyOnce:async()=>{sends++;},readEvents:async()=>[]
  }),/WRONG_WINDOW/);
  assert.equal(sends,0);
});
