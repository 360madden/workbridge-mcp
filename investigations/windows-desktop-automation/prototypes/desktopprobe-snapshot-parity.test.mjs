// Pure in-memory tests; neither module imports Workbridge, WinApp, MCP, UIA or child_process.
// Never persist/emit arbitrary fixture Name/Value/Text from raw synthetic provider trees.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compareReadOnlySnapshots, normalizeReadOnlySnapshot, SOURCE_PINS, typedIdWitnessDigest } from './desktopprobe-snapshot-parity.mjs';

const h = x => createHash('sha256').update(x).digest('hex');
const EPOCH = 621355968000000000n;
const begin = Date.UTC(2026, 10, 5, 23, 40, 0);
const utc = delta => new Date(begin + delta).toISOString();
const ticks = delta => (BigInt(begin + delta) * 10000n + EPOCH).toString();
const copy = o => structuredClone(o);
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k =>
    JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function rawA(extra = []) {
  return { windows: [{ elements: [{ type: 'Window', name: 'BANK PASSWORD SENTINEL',
    value: '123456789', children: [
      { type: 'Button', selector: 'IncrementButton', name: 'BANK PASSWORD SENTINEL' },
      { type: 'Button', selector: 'ResetButton', value: 'ACCOUNT PIN SENTINEL' },
      { type: 'Label', selector: 'CounterDisplay', text: 'PRIVATE ACCOUNT SENTINEL' },
      ...extra
    ] }] }] };
}
function rawB(extra = []) {
  return { success: true, action: 'get_tree', kind: 'full',
    tree: [{ type: 'Window', name: 'BANK PASSWORD SENTINEL',
      value: 'ACCOUNT PIN SENTINEL', children: [
        { type: 'Button', automationId: 'IncrementButton', name: 'BANK PASSWORD SENTINEL' },
        { type: 'Button', automationId: 'ResetButton', value: 'ACCOUNT PIN SENTINEL' },
        { type: 'Text', automationId: 'CounterDisplay', text: 'PRIVATE ACCOUNT SENTINEL' },
        ...extra
      ] }] };
}
function projectA(raw) {
  const structural = []; let maxDepth = 0;
  const visit = (items,d) => {
    for (const item of items) {
      const children = item.children ?? [];
      structural.push([d,item.type.toLowerCase(),children.length]);
      maxDepth = Math.max(maxDepth,d); visit(children,d+1);
    }
  };
  visit(raw.windows[0].elements,0);
  return { nodes:structural.length,maxDepth,structuralSha256:h(JSON.stringify(structural)),
    fixtureControlsVerified:true,payloadBytes:4096 };
}
function projectB(raw) {
  let nodes=0,maxDepth=0;
  function visit(item,depth) {
    nodes++; maxDepth=Math.max(maxDepth,depth);
    return [item.type,(item.children ?? []).map(x=>visit(x,depth+1))];
  }
  const shape=raw.tree.map(x=>visit(x,0));
  return { nodes,maxDepth,structuralSha256:h(JSON.stringify(shape)),
    fixtureControlsVerified:true,payloadBytes:4096,fixtureControlCount:3,
    kind:'full',incomplete:null };
}
function manifest() {
  return {
    schemaVersion:1,runId:'parityrun001',requestId:'parityrun001',
    leaseId:'paritylease001',ownerSid:'S-1-5-21-10-20-30-1001',
    watchdogPid:45678,watchdogStartedAtUtcTicks:ticks(-3000),
    pid:12345,startedAtUtcTicks:ticks(0),sessionId:2,
    hwnd:'889911',foregroundHwnd:'776655',
    className:'WindowsForms10.Window.8.app.0.abc',
    title:'Workbridge GUI-004 Native Input Probe',
    exeSha256:'a'.repeat(64),jobActiveAfterSpawn:2,
    observedAtUtc:utc(3000),deadlineUtc:utc(110000)
  };
}
function lease(m) {
  return { schemaVersion:1,kind:'workbridge.gui-turn',producer:'desktopprobe-watchdog',
    runId:m.runId,requestId:m.requestId,leaseId:m.leaseId,
    owner:{pid:m.watchdogPid,processStartUtcTicks:m.watchdogStartedAtUtcTicks,
      sessionId:m.sessionId},
    target:{kind:'window',pid:null,hwnd:null,process:'DesktopProbe'} };
}
function native(m) {
  return {schemaVersion:1,verified:true,ownerSidVerified:true,watchdogOwnerVerified:true,
    pid:m.pid,startedAtUtcTicks:m.startedAtUtcTicks,sessionId:m.sessionId,
    hwnd:m.hwnd,rootHwnd:m.hwnd,ownerHwnd:'0',className:m.className,
    foregroundHwnd:m.foregroundHwnd,windowStation:'WinSta0',desktopName:'Default',
    rect:{left:100,top:100,right:900,bottom:650,width:800,height:550},
    journal:{sha256:'b'.repeat(64),eventCount:2,shown:true,counter:0,
      unexpectedInputEvents:0}};
}
function phase(m,provider,at,source,withWatchdog = true) {
  const n=native(m);
  if (!withWatchdog) delete n.watchdogOwnerVerified;
  return {observedAtUtc:utc(at),receiptSha256:'c'.repeat(64),
    observerSha256: source,observation:n};
}
function supervisor(m,provider,sampleId) {
  return {schemaVersion:1,provider,runId:m.runId,requestId:m.requestId,
    leaseId:m.leaseId,sampleId,targetPid:m.pid,
    targetStartUtcTicks:m.startedAtUtcTicks,targetSessionId:m.sessionId,
    targetHwnd:m.hwnd,watchdogPid:m.watchdogPid,
    watchdogStartUtcTicks:m.watchdogStartedAtUtcTicks,
    ownerPid:66553,ownerStartUtcTicks:ticks(-6000),
    childPid:66555,childStartUtcTicks:ticks(8000),childSessionId:m.sessionId,
    processTreeSettled:true,privateJobEmpty:true,jobMemberCountAfter:0,
    completeMemberListVerified:true,exitCode:0,receiptSha256:'d'.repeat(64),
    ownerIdentityVerified:true};
}
function sample(provider,m) {
  const a=provider==='winapp',p=SOURCE_PINS[provider],sampleId=a?'trial_winapp_001':'trial_sbroenne_001';
  const raw=a?rawA():rawB();
  const r=a?{schemaVersion:1,provider:p.provider,backendVersion:p.version,sampleId,
    result:'success',reasonCode:'UIA_READ_ONLY_VERIFIED',readOnly:true,
    actualInputActions:0,screenshots:0,target:{pid:m.pid,startedAtUtcTicks:m.startedAtUtcTicks,
      sessionId:m.sessionId,hwnd:m.hwnd},tree:projectA(raw),
    latencyMs:{before:9,version:2,discover:3,inspect:20,after:11,total:47}}
    :{schemaVersion:1,provider:'sbroenne-restricted-mcp-v5',backendVersion:p.version,sampleId,
      state:'success',code:'READONLY_SNAPSHOT_VERIFIED',sourceHash:p.binary,
      targetPid:m.pid,targetHwnd:m.hwnd,processTreeSettlement:'native-host-required',
      tree:projectB(raw),
      latencyMs:{pin:5,before:8,versionOrConnect:12,preDispatch:8,
        discoverOrSnapshot:22,after:8,close:2,total:76}};
  const l=lease(m);
  const result={provider,manifest:m,lease:l,sampleId,readOnly:true,actualInputActions:0,
    screenshots:0,admittedAtUtc:utc(6000),privateReceiptSha256:'e'.repeat(64),
    source:{adapterSha256:p.adapter,nativeObserverSha256:p.observer,
      observedBinarySha256:a?'f'.repeat(64):p.binary,
      approvedBinarySha256:a?'f'.repeat(64):p.binary,
      manifestReceiptSha256:'3'.repeat(64),leaseReceiptSha256:'4'.repeat(64),
      manifestCanonicalSha256:h(canonical(m)),leaseCanonicalSha256:h(canonical(l))},
    native:a?{before:phase(m,provider,8500,p.observer,false),
      after:phase(m,provider,30500,p.observer,false)}
      :{before:phase(m,provider,8500,p.observer),
        preDispatch:phase(m,provider,21000,p.observer),
        after:phase(m,provider,30500,p.observer)},
    watchdogWitness:a?phase(m,'sbroenne',20500,SOURCE_PINS.sbroenne.observer):undefined,
    dispatch:{operation:a?'inspect':'ui_snapshot',targetPid:m.pid,targetHwnd:m.hwnd,
      depth:1,mode:a?undefined:'full',includeDiagnostics:a?undefined:false,
      atUtc:utc(22000)},
    rawTree:raw,receipt:r,supervisor:supervisor(m,provider,sampleId)};
  result.strictTypedWitness={schemaVersion:1,provider,runId:m.runId,requestId:m.requestId,
    leaseId:m.leaseId,sampleId,targetPid:m.pid,targetStartUtcTicks:m.startedAtUtcTicks,
    targetSessionId:m.sessionId,targetHwnd:m.hwnd,
    producerAdapterSha256:p.adapter,
    providerBinarySha256:result.source.observedBinarySha256,
    producerPid:result.supervisor.childPid,
    producerStartUtcTicks:result.supervisor.childStartUtcTicks,
    typedIdStructuralSha256:typedIdWitnessDigest(provider,raw),
    manifestCanonicalSha256:result.source.manifestCanonicalSha256,
    leaseCanonicalSha256:result.source.leaseCanonicalSha256,
    privateReceiptSha256:result.privateReceiptSha256,
    captureCompleteness:'full',ambiguous:false,suppressed:false,notReplayed:true,
    observedAtUtc:utc(25000),witnessReceiptSha256:'7'.repeat(64)};
  result.supervisor.providerReceiptSha256=result.privateReceiptSha256;
  result.supervisor.strictWitnessReceiptSha256=result.strictTypedWitness.witnessReceiptSha256;
  return result;
}
function pair() {
  const m=manifest();return {a:sample('winapp',m),b:sample('sbroenne',m)};
}

test('P01 both independently verified samples normalize to the same three typed controls',()=>{
  const {a,b}=pair(), out=compareReadOnlySnapshots(a,b);
  assert.equal(out.status,'verified_control_parity');
  assert.equal(out.parity.typedControls,'verified');
  assert.deepEqual(out.winapp.controls,{IncrementButton:'Button',ResetButton:'Button',CounterDisplay:'Text'});
  assert.deepEqual(out.sbroenne.controls,out.winapp.controls);
  assert.equal(out.parity.structuralHashesComparable,false);
  assert.equal(out.parity.endToEndLatencyDirectlyComparable,false);
  assert.equal(out.winapp.latencyMs.extraNativeObserver,false);
  assert.equal(out.sbroenne.latencyMs.extraNativeObserver,true);
});
test('P02 never copy private arbitrary UI text, even with source Name/Value/Text',()=>{
  const out=compareReadOnlySnapshots(...Object.values(pair()));
  const publicJson=JSON.stringify(out);
  for (const secret of ['BANK PASSWORD SENTINEL','ACCOUNT PIN SENTINEL','PRIVATE ACCOUNT SENTINEL'])
    assert.equal(publicJson.includes(secret),false);
});
test('P03 WinApp wrong-type duplicate selector is rejected despite prior projected success',()=>{
  const {a}=pair();
  a.rawTree=rawA([{type:'Text',selector:'IncrementButton',text:'PRIVATE ACCOUNT SENTINEL'}]);
  assert.equal(normalizeReadOnlySnapshot(a).status,'unknown_outcome');
  assert.equal(normalizeReadOnlySnapshot(a).reasonCode,'CONTROL_TYPE_AMBIGUOUS');
});
test('P04 Sbroenne duplicate correct-type automationId is rejected',()=>{
  const {b}=pair();
  b.rawTree=rawB([{type:'Button',automationId:'IncrementButton'}]);
  assert.equal(normalizeReadOnlySnapshot(b).reasonCode,'CONTROLS_MISSING_DUPLICATED_OR_AMBIGUOUS');
});
test('P05 suppressed, partial, omitted ephemeral provider trees fail UNKNOWN',()=>{
  const {a,b}=pair();
  for (const raw of [null,{...rawA(),suppressed:true},{...rawA(),truncated:true}]) {
    const s=copy(a);s.rawTree=raw;
    assert.equal(normalizeReadOnlySnapshot(s).status,'unknown_outcome');
  }
  b.rawTree.tree[0].children[0].childrenSuppressed=true;
  assert.equal(normalizeReadOnlySnapshot(b).status,'unknown_outcome');
});
test('P06 incumbent WinApp without independent watchdog witness remains UNKNOWN',()=>{
  const {a}=pair();delete a.watchdogWitness;
  assert.equal(normalizeReadOnlySnapshot(a).reasonCode,'NATIVE_ORACLE_MISSING_OR_DRIFTED');
});
test('P07 foreign supervisor runId, child session, sampleId, unproven Job0 fail UNKNOWN',()=>{
  const {b}=pair();
  for (const keyVal of [
    ['runId','foreignrun001'],['sampleId','foreigntrial001'],['childSessionId',3],
    ['jobMemberCountAfter',2],['completeMemberListVerified',false]
  ]) {
    const x=copy(b);x.supervisor[keyVal[0]]=keyVal[1];
    assert.equal(normalizeReadOnlySnapshot(x).reasonCode,'PROCESS_SETTLEMENT_UNKNOWN_OR_FOREIGN');
  }
});
test('P08 manifest and lease canonical hashes must bind the same exact in-memory evidence',()=>{
  const {a}=pair();
  a.manifest.pid++;
  assert.equal(normalizeReadOnlySnapshot(a).status,'unknown_outcome');
  const b=pair().b;b.source.leaseCanonicalSha256='1'.repeat(64);
  assert.equal(normalizeReadOnlySnapshot(b).reasonCode,'PINNED_SOURCE_NOT_PROVEN');
});
test('P09 stale fixture, past deadline, wrong dispatch HWND, uncertain time fail UNKNOWN',()=>{
  const {a,b}=pair();
  const old=copy(a);old.admittedAtUtc=utc(109000);
  assert.equal(normalizeReadOnlySnapshot(old).status,'unknown_outcome');
  const changed=copy(b);changed.dispatch.targetHwnd='1';
  assert.equal(normalizeReadOnlySnapshot(changed).reasonCode,'EXPLICIT_TARGET_DISPATCH_MISSING');
  const late=copy(b);late.dispatch.atUtc=utc(95000);
  assert.equal(normalizeReadOnlySnapshot(late).status,'unknown_outcome');
  const bad=copy(a);bad.native.after.observedAtUtc='unknown';
  assert.equal(normalizeReadOnlySnapshot(bad).status,'unknown_outcome');
});
test('P10 independent native target changes or cross-provider target differences reject pair',()=>{
  const {a,b}=pair();
  b.native.after.observation.foregroundHwnd='123';
  assert.equal(normalizeReadOnlySnapshot(b).reasonCode,'NATIVE_ORACLE_MISSING_OR_DRIFTED');
  const fresh=pair();
  fresh.b.manifest=copy(fresh.b.manifest);fresh.b.manifest.hwnd='445566';
  const result=compareReadOnlySnapshots(fresh.a,fresh.b);
  assert.equal(result.status,'unknown_outcome');
  assert.equal(result.parity,null);
});
test('P11 real raw trees can be same controls yet legitimately different node counts',()=>{
  const {a,b}=pair();
  b.rawTree=rawB([{type:'Group',automationId:'OtherControl'}]);
  b.receipt.tree=projectB(b.rawTree);
  b.strictTypedWitness.typedIdStructuralSha256=typedIdWitnessDigest('sbroenne',b.rawTree);
  const out=compareReadOnlySnapshots(a,b);
  assert.equal(out.status,'verified_control_parity');
  assert.equal(out.parity.typedControls,'verified');
  assert.equal(out.parity.structuralCounts,'different');
  assert.equal(out.parity.structuralHashesComparable,false);
});
test('P12 public compact receipts alone cannot claim full strict typed parity',()=>{
  const {a,b}=pair();
  delete a.rawTree;delete b.rawTree;
  assert.equal(compareReadOnlySnapshots(a,b).status,'unknown_outcome');
});
test('P13 source pin changes and source-only backend ACK without native proof fail UNKNOWN',()=>{
  const {a,b}=pair();
  a.source.adapterSha256='9'.repeat(64);
  assert.equal(normalizeReadOnlySnapshot(a).reasonCode,'PINNED_SOURCE_NOT_PROVEN');
  b.native.preDispatch.observation.journal.sha256='0'.repeat(64);
  assert.equal(normalizeReadOnlySnapshot(b).reasonCode,'NATIVE_STATE_CHANGED');
});
test('P14 no unexpected direct GUI process imports from pure module source',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {fileURLToPath}=await import('node:url');
  const source=await readFile(fileURLToPath(new URL('./desktopprobe-snapshot-parity.mjs',import.meta.url)),'utf8');
  for (const forbidden of ["'node:fs'","'node:child_process'","'node:process'","'@modelcontextprotocol'",'client.callTool(','executeReadOnly(','winapp.exe','SetForegroundWindow'])
    assert.equal(source.includes(forbidden),false);
});

test('P15 raw ephemeral same-shape substitution without producer typed-ID witness fails UNKNOWN',()=>{
  const {a}=pair();
  // Projected structural hash cannot detect changed selector IDs at the same position.
  a.rawTree.windows[0].elements[0].children[0].selector='OtherControl';
  const out=normalizeReadOnlySnapshot(a);
  assert.equal(out.status,'unknown_outcome');
  assert.ok(['CONTROLS_MISSING_DUPLICATED_OR_AMBIGUOUS',
    'TYPED_ID_WITNESS_MISSING_UNBOUND_OR_AMBIGUOUS'].includes(out.reasonCode));
  const {b}=pair();
  b.strictTypedWitness.typedIdStructuralSha256='9'.repeat(64);
  assert.equal(normalizeReadOnlySnapshot(b).reasonCode,'TYPED_ID_WITNESS_MISSING_UNBOUND_OR_AMBIGUOUS');
});
test('P16 WinApp extra watchdog witness AFTER dispatch cannot retroactively authorize read',()=>{
  const {a}=pair();
  a.watchdogWitness.observedAtUtc=utc(23500);
  assert.equal(normalizeReadOnlySnapshot(a).reasonCode,'NATIVE_WITNESS_TIME_UNVERIFIED');
});
test('P17 owner Job0 receipt must name same provider receipt and strict witness',()=>{
  const {a,b}=pair();
  a.supervisor.providerReceiptSha256='0'.repeat(64);
  assert.equal(normalizeReadOnlySnapshot(a).reasonCode,'PROCESS_SETTLEMENT_UNKNOWN_OR_FOREIGN');
  b.supervisor.strictWitnessReceiptSha256='0'.repeat(64);
  assert.equal(normalizeReadOnlySnapshot(b).reasonCode,'PROCESS_SETTLEMENT_UNKNOWN_OR_FOREIGN');
});
test('P18 witness owner PID/start and sample/lease identity never transfer between samples',()=>{
  const {a,b}=pair();
  for (const [field,val] of [['producerPid',90000],['sampleId','foreigntrial01'],
    ['leaseId','anotherlease01'],['producerStartUtcTicks',ticks(9000)]]) {
    const x=copy(a);x.strictTypedWitness[field]=val;
    assert.equal(normalizeReadOnlySnapshot(x).reasonCode,'TYPED_ID_WITNESS_MISSING_UNBOUND_OR_AMBIGUOUS');
  }
  delete b.strictTypedWitness;
  assert.equal(normalizeReadOnlySnapshot(b).reasonCode,'TYPED_ID_WITNESS_MISSING_UNBOUND_OR_AMBIGUOUS');
});
