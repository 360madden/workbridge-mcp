#!/usr/bin/env node
// Physical Windows RIFT only; never VMware.
// Stage sends Enter and fixed literal /rre candidates, but NO final Enter.
// Submit requires a second independently reviewed screenshot of exact native
// RIFT chat content with visible caret and no LuaPad/editor. The screenshot
// capture itself can change focus: submit remains disabled absent a separate
// trusted post-capture chat-focus bridge. No blind Enter or retries.
import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readdir, readFile, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withDesktopAdmission } from './desktop-turn-admission.mjs';
import { runWinapp } from './desktop-ui.mjs';
import {
  inspectPhysicalRift, readVerifiedChatEvidence, getWindowsProcessIdentity,
  assertPhysicalRiftWindow,
} from './physical-rift-reloadui.mjs';

const ROOT = path.join(fileURLToPath(new URL('..', import.meta.url)), '.tools', 'desktop-evidence');
const PROCESS='rift_x64', TITLE='RIFT', CLASS='TWNClientFramework';
const CONFIRMATION='one-physical-rift-candidates';
const STAGE_ATTESTATION='chat-closed-empty-editor-absent';
const SUBMIT_ATTESTATION='rift-chat-focused-exact-candidates-editor-absent';
const STAGE_ACTION=Object.freeze(['Enter','/rre candidates']);
const SUBMIT_ACTION=Object.freeze(['Enter']);
const STAGE_INTENT='physical-rift-candidates-stage-singleton.intent.json';
const SUBMIT_INTENT='physical-rift-candidates-submit-singleton.intent.json';

export class RiftCandidatesError extends Error {
  constructor(code,message){super(message);this.name='RiftCandidatesError';this.code=code;}
}
function refuse(code,message){throw new RiftCandidatesError(code,message);}
function decimal(value,label){
  if(!/^[1-9][0-9]*$/.test(String(value??'')))refuse('INVALID_TARGET',label+' must be decimal');
  const n=Number(value);if(!Number.isSafeInteger(n))refuse('INVALID_TARGET',label+' must be safe integer');
  return n;
}
export function parseCandidatesRequest(argv){
  const seen=new Set();
  for(const token of argv)if(token.startsWith('--')){
    const name=token.split('=')[0];
    if(seen.has(name))refuse('INVALID_ARGUMENTS','Duplicate option');
    seen.add(name);
  }
  let v;
  try{({values:v}=parseArgs({args:argv,strict:true,allowPositionals:false,options:{
    pid:{type:'string'},hwnd:{type:'string'},'started-utc':{type:'string'},
    'request-id':{type:'string'},confirm:{type:'string'},
    'preflight-only':{type:'boolean'},'stage-once':{type:'boolean'},
    'submit-once':{type:'boolean'},'screenshot-request-id':{type:'string'},
    'chat-visual-attestation':{type:'string'},
  }}));}catch{refuse('INVALID_ARGUMENTS','Unknown option or missing target');}
  const pid=decimal(v.pid,'pid'),hwnd=decimal(v.hwnd,'hwnd');
  if(pid>0x7fffffff)refuse('INVALID_TARGET','PID out of range');
  const startedUtc=v['started-utc'];
  if(typeof startedUtc!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(startedUtc)||
    !Number.isFinite(Date.parse(startedUtc)))refuse('INVALID_PROCESS_START','Fresh start timestamp required');
  const requestId=v['request-id'];
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(requestId??''))refuse('INVALID_REQUEST_ID','Bounded ID required');
  if(v.confirm!==CONFIRMATION)refuse('CONFIRMATION_REQUIRED','Exact candidates confirmation required');
  const modes=Number(!!v['preflight-only'])+Number(!!v['stage-once'])+Number(!!v['submit-once']);
  if(modes!==1)refuse('MODE_REQUIRED','Choose exactly one preflight, stage, submit');
  const phase=v['stage-once']?'stage':v['submit-once']?'submit':null;
  const expected=phase==='stage'?STAGE_ATTESTATION:SUBMIT_ATTESTATION;
  if(phase){
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(v['screenshot-request-id']??'')||
      v['chat-visual-attestation']!==expected)
      refuse('CHAT_STATE_GATE_REQUIRED','Fresh phase-specific visual proof required');
  }else if(v['screenshot-request-id']!==undefined||v['chat-visual-attestation']!==undefined){
    refuse('INVALID_ARGUMENTS','Visual proof only with stage/submit');
  }
  return Object.freeze({pid,hwnd,startedUtc,requestId,phase,
    preflightOnly:!phase,executeOnce:phase==='stage',
    screenshotRequestId:phase?v['screenshot-request-id']:null,
    chatVisualAttestation:phase?v['chat-visual-attestation']:null});
}
function parseJson(raw,label){
  try{return JSON.parse(raw);}catch{refuse('INVALID_PROVIDER_JSON',label+' invalid JSON');}
}
function assertProcessIdentity(result,request){
  if(Number(result?.pid)!==request.pid||
    !Number.isInteger(result?.sessionId)||result.sessionId<0||
    !Number.isFinite(Date.parse(result?.startedUtc??''))||
    Math.abs(Date.parse(result.startedUtc)-Date.parse(request.startedUtc))>1)
    refuse('STALE_PROCESS','Exact PID/start/session changed');
}
function intentName(phase){return phase==='stage'?STAGE_INTENT:SUBMIT_INTENT;}
function receiptName(phase,id){return 'physical-rift-candidates-'+phase+'-'+id+'.receipt.json';}
function validatePhase(request){
  if(!['stage','submit'].includes(request?.phase))refuse('INVALID_OPERATION','Stage or submit required');
  if(request.chatVisualAttestation!==(request.phase==='stage'?STAGE_ATTESTATION:SUBMIT_ATTESTATION)||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(request.screenshotRequestId??''))
    refuse('CHAT_STATE_GATE_REQUIRED','Phase-specific screenshot and attestation required');
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
async function writeExclusiveJson(filename, obj) {
  const bytes = Buffer.from(JSON.stringify(obj) + '\n', 'utf8');
  if (bytes.length > 4096) refuse('RECEIPT_TOO_LARGE', 'Bounded journal record exceeded 4096 bytes');
  let h;
  try { h = await open(filename, 'wx', 0o600); }
  catch (e) {
    if (e?.code === 'EEXIST') refuse('ACTION_RECOVERY_REQUIRED', 'Existing one-shot intent or receipt requires review');
    throw e;
  }
  try {
    await h.writeFile(bytes);
    await h.sync();
  } finally { await h.close(); }
  return { bytes, sha256: hash(bytes) };
}

async function quarantineVeto(root) {
  const names = await readdir(root);
  if (names.some((n) => n.startsWith('desktop-turn-quarantine-') && n.endsWith('.json'))) {
    refuse('UI_TURN_RECOVERY_REQUIRED', 'A desktop quarantine sidecar forbids new keyboard input');
  }
}

async function releaseOwnedTurn(filename, original, journal) {
  const before = await lstat(filename);
  const bytes = await readFile(filename);
  const after = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.dev !== original.dev || before.ino !== original.ino ||
      after.dev !== before.dev || after.ino !== before.ino ||
      before.size !== journal.bytes.length ||
      after.size !== before.size || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs || hash(bytes) !== journal.sha256) {
    refuse('UI_TURN_RECOVERY_REQUIRED', 'Desktop turn owner changed; retain the foreign lock');
  }
  await unlink(filename);
}

async function createTurn(root, request, observed, producer = 'physical-rift-candidates') {
  const filename = path.join(root, 'desktop-input-turn.lock');
  const stamp = {
    schemaVersion: 1, kind: 'workbridge.gui-turn',
    leaseId: randomUUID(), producer,
    requestId: request.requestId, owner: { pid: process.pid, processStartUtc: null, sessionId: observed.sessionId },
    target: { kind: 'window', pid: request.pid, hwnd: request.hwnd, process: PROCESS },
    acquiredUtc: new Date().toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(stamp) + '\n', 'utf8');
  let h;
  try { h = await open(filename, 'wx', 0o600); }
  catch (e) {
    if (e?.code === 'EEXIST') refuse('UI_TURN_BUSY', 'Another desktop GUI turn or retained lock exists');
    throw e;
  }
  const original = await h.stat();
  try {
    await h.writeFile(bytes);
    await h.sync();
  } finally { await h.close(); }
  return { filename, original, leaseId: stamp.leaseId, journal: { bytes, sha256: hash(bytes) } };
}

async function readBoundedJson(filename) {
  let bytes;
  try { bytes = await readFile(filename); }
  catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
  if (bytes.length > 4096) refuse('ACTION_RECOVERY_REQUIRED', 'Existing marker exceeded bound');
  return parseJson(bytes.toString('utf8'), 'Existing one-shot marker');
}



export async function readVerifiedCandidatesEvidence(request, {
  root=ROOT, now=()=>Date.now(), getProcess=getWindowsProcessIdentity, stageReceipt=null,
}={}){
  validatePhase(request);
  if(request.phase==='stage'){
    const captured=await readVerifiedChatEvidence({
      ...request,executeOnce:true,chatVisualAttestation:'chat-closed-empty',
    },{root,now,getProcess});
    return Object.freeze({...captured,state:STAGE_ATTESTATION});
  }
  if(!stageReceipt || stageReceipt.completed!==true || stageReceipt.staged!==true ||
     stageReceipt.requestId!==request.requestId ||
     !Number.isFinite(Date.parse(stageReceipt.stagedUtc??'')))
    refuse('STAGE_RECEIPT_REQUIRED','Matching completed stage receipt required');
  const id=request.screenshotRequestId;
  const metadataPath=path.join(root,'capture-'+id+'.json');
  const imagePath=path.join(root,'capture-'+id+'.png');
  const [ms,is]=await Promise.all([
    lstat(metadataPath).catch(()=>null),lstat(imagePath).catch(()=>null),
  ]);
  if(!ms?.isFile()||ms.isSymbolicLink()||!is?.isFile()||is.isSymbolicLink()||
    ms.size<100||ms.size>4096||is.size<10000||is.size>16*1024*1024)
    refuse('CAPTURE_EVIDENCE_UNAVAILABLE','Bounded screenshot receipt/PNG required');
  const receipt=parseJson(await readFile(metadataPath,'utf8'),'Screenshot receipt');
  const bytes=await readFile(imagePath);
  const capturedAt=Date.parse(receipt.capturedUtc??'');
  const age=now()-capturedAt;
  if(receipt.schemaVersion!==1 || receipt.requestId!==id ||
     receipt.pid!==request.pid||receipt.hwnd!==request.hwnd||
     receipt.process!==PROCESS||receipt.title!==TITLE||
     receipt.expectedClass!==CLASS||receipt.inputInjected!==false||
     typeof receipt.imagePath!=='string'||
     receipt.imagePath.toLowerCase()!==path.resolve(imagePath).toLowerCase()||
     !Number.isInteger(receipt.sizeBytes)||receipt.sizeBytes!==bytes.length||
     receipt.sizeBytes!==is.size||
     !Number.isFinite(receipt.width)||receipt.width<700||
     !Number.isFinite(receipt.height)||receipt.height<500||
     !/^[a-f0-9]{64}$/i.test(receipt.sha256??'')||
     hash(bytes)!==receipt.sha256.toLowerCase()||
     !Number.isFinite(age)||age<-1000||age>30000||
     capturedAt<Date.parse(stageReceipt.stagedUtc))
    refuse('CHAT_STATE_UNVERIFIED','Post-stage capture stale, corrupted, or not newer than stage');
  const processRecord=await getProcess(request.pid);
  assertProcessIdentity(processRecord,request);
  return Object.freeze({confirmed:true,state:SUBMIT_ATTESTATION,
    pid:request.pid,hwnd:request.hwnd,startedUtc:request.startedUtc,
    sessionId:processRecord.sessionId,capturedUtc:receipt.capturedUtc,
    imageSha256:receipt.sha256.toLowerCase()});
}


export async function executePhysicalCandidatesPhase(request,{
  runner=runWinapp,getProcess=getWindowsProcessIdentity,sender,chatEvidence,
  root=ROOT,verifyNativeChatFocus=null,
}={}){
  validatePhase(request);
  if(typeof sender!=='function')refuse('NO_VALIDATED_INPUT_TRANSPORT','Fixed target-bound sender required');
  if(request.phase==='submit'&&typeof verifyNativeChatFocus!=='function')
    refuse('CHAT_FOCUS_BRIDGE_UNAVAILABLE','No post-capture native RIFT chat-focus proof available');
  if(chatEvidence?.confirmed!==true||
     chatEvidence.state!==(request.phase==='stage'?STAGE_ATTESTATION:SUBMIT_ATTESTATION)||
     chatEvidence.pid!==request.pid||chatEvidence.hwnd!==request.hwnd||
     chatEvidence.startedUtc!==request.startedUtc||
     !/^[a-f0-9]{64}$/i.test(chatEvidence.imageSha256??'')||
     !Number.isFinite(Date.parse(chatEvidence.capturedUtc??''))||
     Date.now()-Date.parse(chatEvidence.capturedUtc)<-1000||
     Date.now()-Date.parse(chatEvidence.capturedUtc)>60000)
    refuse('CHAT_STATE_UNVERIFIED','Fresh matching phase screenshot proof required');
  await mkdir(root,{recursive:true});
  const lockPath=path.join(root,'desktop-input-turn.lock');
  return await withDesktopAdmission(lockPath,
    {producer:'physical-rift-candidates',requestId:request.requestId},
    async()=>{
      await quarantineVeto(root);
      const markerPath=path.join(root,intentName(request.phase));
      const receiptPath=path.join(root,receiptName(request.phase,request.requestId));
      const existing=await readBoundedJson(markerPath);
      if(existing){
        if(existing.requestId!==request.requestId)
          refuse('ACTION_RECOVERY_REQUIRED','Another candidates attempt already exists');
        const prior=await readBoundedJson(receiptPath);
        if(prior?.completed!==true||prior?.requestId!==request.requestId||
           prior.phase!==request.phase)refuse('ACTION_RECOVERY_REQUIRED','Prior action uncertain; do not resend');
        return {ok:true,replayed:true,phase:request.phase,inputSubmitted:false,
          status:'PREVIOUS_PHASE_DO_NOT_REPEAT'};
      }
      const stageIntent=await readBoundedJson(path.join(root,STAGE_INTENT));
      const stageReceipt=await readBoundedJson(path.join(root,receiptName('stage',request.requestId)));
      if(request.phase==='stage'){
        if(await readBoundedJson(path.join(root,SUBMIT_INTENT)))
          refuse('ACTION_RECOVERY_REQUIRED','A submit attempt already exists');
      }else{
        if(!stageIntent||stageIntent.requestId!==request.requestId||
           stageIntent.action!=='/rre candidates'||
           stageIntent.target?.pid!==request.pid||
           stageIntent.target?.hwnd!==request.hwnd||
           stageIntent.target?.startedUtc!==request.startedUtc||
           !stageReceipt||stageReceipt.completed!==true||
           stageReceipt.phase!=='stage'||stageReceipt.staged!==true||
           stageReceipt.requestId!==request.requestId||
           stageReceipt.sessionId!==chatEvidence.sessionId||
           stageReceipt.imageSha256!==stageIntent.capture?.sha256)
          refuse('STAGE_RECEIPT_REQUIRED','Staging identity/receipt cannot be reconciled');
      }
      const foreground=request.phase==='submit';
      const observed=await inspectPhysicalRift(request,{runner,getProcess,requireForeground:foreground});
      if(observed.sessionId!==chatEvidence.sessionId)
        refuse('SESSION_MISMATCH','Capture/game process session mismatch');
      const turn=await createTurn(root,request,observed,'physical-rift-candidates');
      let intentCreated=false,intentSha256=null;
      try{
        await quarantineVeto(root);
        const latest=await inspectPhysicalRift(request,{runner,getProcess,requireForeground:foreground});
        if(latest.sessionId!==observed.sessionId||
           latest.rootSelector!==observed.rootSelector||
           !/^[A-Za-z0-9_-]{3,96}$/.test(latest.rootSelector??''))
          refuse('STALE_TARGET','Window/session/root changed');
        const actions=request.phase==='stage'?STAGE_ACTION:SUBMIT_ACTION;
        const intent={
          schemaVersion:1,kind:'workbridge.physical-rift-candidates-'+request.phase+'-intent',
          requestId:request.requestId,phase:request.phase,leaseId:turn.leaseId,
          target:{pid:request.pid,hwnd:request.hwnd,process:PROCESS,
            title:TITLE,className:CLASS,startedUtc:request.startedUtc,
            sessionId:observed.sessionId,rootSelector:latest.rootSelector},
          capture:{requestId:request.screenshotRequestId,
            sha256:chatEvidence.imageSha256,capturedUtc:chatEvidence.capturedUtc,
            visualAttestation:request.chatVisualAttestation},
          action:'/rre candidates',
          plannedActions:request.phase==='stage'?['uia-root-focus',...STAGE_ACTION]:[...SUBMIT_ACTION],
          startedUtc:new Date().toISOString(),
        };
        const j=await writeExclusiveJson(markerPath,intent);
        intentCreated=true;intentSha256=j.sha256;
        // A synthetic verifier can model a future trusted native focus bridge.
        // The production CLI does not supply one and therefore cannot submit.
        if(request.phase==='submit'){
          const proof=await verifyNativeChatFocus({request,observed:latest,chatEvidence});
          if(proof!==true)refuse('CHAT_FOCUS_UNVERIFIED','Native focused RIFT chat field not proven');
        }
        const response=await sender(Object.freeze({
          pid:request.pid,hwnd:request.hwnd,startedUtc:request.startedUtc,
          sessionId:observed.sessionId,rootSelector:latest.rootSelector,
          phase:request.phase,allowInitialFocus:request.phase==='stage',
          sequence:actions,
        }));
        if(response?.submitted!==true||response.sequenceCount!==actions.length||
           response.targetPid!==request.pid||response.targetHwnd!==request.hwnd||
           response.senderSessionId!==observed.sessionId||
           response.focusPerformed!==(request.phase==='stage'))
          refuse('ACTION_RECOVERY_REQUIRED','Native delivery uncertain');
        const finishedUtc=new Date().toISOString();
        await writeExclusiveJson(receiptPath,{
          schemaVersion:1,kind:'workbridge.physical-rift-candidates-'+request.phase+'-receipt',
          requestId:request.requestId,phase:request.phase,
          pid:request.pid,hwnd:request.hwnd,startedUtc:request.startedUtc,
          sessionId:observed.sessionId,
          completed:true,staged:request.phase==='stage',
          submitted:request.phase==='submit',verified:false,
          imageSha256:chatEvidence.imageSha256,
          stagedUtc:request.phase==='stage'?finishedUtc:undefined,
          submittedUtc:request.phase==='submit'?finishedUtc:undefined,
        });
        await releaseOwnedTurn(turn.filename,turn.original,turn.journal);
        return {ok:true,replayed:false,phase:request.phase,
          inputSubmitted:request.phase==='submit',verified:false,
          status:request.phase==='stage'
            ?'STAGED_UNSUBMITTED_REQUIRES_FRESH_VISUAL_REVIEW'
            :'SUBMITTED_PENDING_INDEPENDENT_GAME_EVIDENCE'};
      }catch(error){
        if(intentCreated){
          try{
            await writeExclusiveJson(path.join(root,'desktop-turn-quarantine-'+turn.leaseId+'.json'),{
              schemaVersion:1,kind:'workbridge.gui-turn-quarantine',
              leaseId:turn.leaseId,requestId:request.requestId,phase:request.phase,
              ownerStampSha256:turn.journal.sha256,intentSha256,
              reasonCode:'ACTION_RECOVERY_REQUIRED',
              processTreeSettlement:'unknown',automaticRetryAllowed:false,
              createdUtc:new Date().toISOString(),
            });
          }catch{refuse('ACTION_RECOVERY_REQUIRED','Quarantine seal unavailable; GUI lock retained');}
        }else await releaseOwnedTurn(turn.filename,turn.original,turn.journal);
        throw error;
      }
    });
}

/**
 * Fixed literals only. Stage emits Enter + verbatim /rre candidates, NEVER a final Enter.
 * Submit is a separate one-key operation after a new screenshot and independent
 * post-capture game-chat focus proof. Production CLI deliberately disables submit
 * until a trusted chat-focus bridge exists; top-level foreground is insufficient.
 */
export function createGuardedCandidatesSender({
  runner = runWinapp,
  getProcess = getWindowsProcessIdentity,
  chatClosedEvidence,
  verifyNativeChatFocus = null,
  now = () => Date.now(),
} = {}) {
  if (!chatClosedEvidence || typeof chatClosedEvidence !== 'object') {
    refuse('CHAT_STATE_GATE_REQUIRED', 'Fresh pre-lock chat-closed evidence is required');
  }
  const evidence = Object.freeze({
    confirmed: chatClosedEvidence.confirmed,
    state: chatClosedEvidence.state,
    pid: chatClosedEvidence.pid,
    hwnd: chatClosedEvidence.hwnd,
    startedUtc: chatClosedEvidence.startedUtc,
    sessionId: chatClosedEvidence.sessionId,
    capturedUtc: chatClosedEvidence.capturedUtc,
    imageSha256: chatClosedEvidence.imageSha256,
  });
  return async function sendCandidatesPhase(input) {
    const actions = input?.phase === 'stage' ? STAGE_ACTION : input?.phase === 'submit' ? SUBMIT_ACTION : [];
    if (!input || !['stage', 'submit'].includes(input.phase) ||
        (input.phase === 'submit' && input.allowInitialFocus === true) ||
        !Array.isArray(input.sequence) ||
        input.sequence.length !== actions.length ||
        input.sequence.some((key, index) => key !== actions[index])) {
      refuse('INVALID_ACTION_SEQUENCE', 'Exact immutable phase sequence required');
    }
    const target = { pid: input.pid, hwnd: input.hwnd, startedUtc: input.startedUtc };
    let sessionId = null;
    let firstKeyStartedAt = null;
    for (let phase = 0; phase < actions.length; phase++) {
      if (firstKeyStartedAt !== null && (now() - firstKeyStartedAt < 0 || now() - firstKeyStartedAt > 60000)) {
        refuse('INPUT_TURN_EXPIRED', 'A keyboard phase exceeded the bounded 60-second input turn');
      }
      const current = await inspectPhysicalRift(target, {
        runner, getProcess,
        requireForeground: !(phase === 0 && input.allowInitialFocus === true),
      });
      if (current.sessionId !== input.sessionId ||
          (sessionId !== null && current.sessionId !== sessionId)) {
        refuse('SESSION_MISMATCH', 'Physical game or input session changed before a key phase');
      }
      sessionId = current.sessionId;
      // The same pre-lock screenshot only proves chat was initially closed/empty.
      // No nested capture/control call or invented per-phase chat-state assertion.
      const age = now() - Date.parse(evidence.capturedUtc ?? '');
      if (evidence.confirmed !== true || evidence.state !== (input.phase === 'stage' ? STAGE_ATTESTATION : SUBMIT_ATTESTATION) ||
          evidence.pid !== input.pid || evidence.hwnd !== input.hwnd ||
          evidence.startedUtc !== input.startedUtc || evidence.sessionId !== input.sessionId ||
          (phase === 0 && (!Number.isFinite(age) || age < -1000 || age > 60000)) ||
          !/^[a-f0-9]{64}$/i.test(evidence.imageSha256 ?? '')) {
        refuse('CHAT_STATE_UNVERIFIED', 'Initial chat-closed screenshot proof is missing/stale');
      }
      // Exactly one UIA focus after durable intent in this same exclusive lease.
      // No full UIA inspection or external tool roundtrip after focus, and
      // never refocus if any keyboard event may already have been delivered.
      if (phase === 0 && input.allowInitialFocus === true) {
        if (typeof input.rootSelector !== 'string' ||
            !/^[A-Za-z0-9_-]{3,96}$/.test(input.rootSelector) ||
            current.rootSelector !== input.rootSelector) {
          refuse('FOCUS_SELECTOR_UNAVAILABLE', 'Physical RIFT root changed before focus');
        }
        const focusReply = parseJson(await runner([
          'ui', 'focus', current.rootSelector, '-w', String(input.hwnd), '--json',
        ]), 'Integrated native UIA focus');
        if (focusReply?.ok === false || focusReply?.success === false || focusReply?.error || (focusReply?.hwnd !== undefined && Number(focusReply.hwnd) !== input.hwnd)) {
          refuse('ACTION_RECOVERY_REQUIRED', 'Native focus targeted unexpected HWND');
        }
      }
      // Verify exact foreground HWND + process/session immediately before key.
      const justBefore = parseJson(await runner([
        'ui', 'list-windows', '-a', String(input.pid), '--json',
      ]), 'Immediate foreground check');
      assertPhysicalRiftWindow({ windows: justBefore }, target);
      const processBeforeKey = await getProcess(input.pid);
      assertProcessIdentity(processBeforeKey, target);
      if (processBeforeKey.sessionId !== sessionId) {
        refuse('TARGET_CHANGED_BEFORE_KEY', 'Physical game session changed immediately before key');
      }
      const literal = input.phase === 'stage' && phase === 1;
      const keys = literal ? actions[phase] : 'enter';
      const args = ['ui', 'send-keys', keys, '-w', String(input.hwnd),
        '--via', 'send-input'];
      if (literal) args.push('--verbatim');
      args.push('--json');
      // Guard a slow focus/identity check: evidence remains fresh at first key.
      const ageBeforeFirstKey = now() - Date.parse(evidence.capturedUtc ?? '');
      if (phase === 0 && (!Number.isFinite(ageBeforeFirstKey) || ageBeforeFirstKey < -1000 || ageBeforeFirstKey > 60000)) {
        refuse('CHAT_STATE_UNVERIFIED', 'Chat-closed evidence expired before the first physical RIFT key');
      }
      if (input.phase === 'submit') {
        // Must be a non-focus-changing, trusted native chat-focus probe.
        // This is the LAST check before the single final Enter and occurs
        // AFTER all UIA/root/foreground checks, inside the same GUI lease.
        // A screenshot and top-level HWND foreground are not sufficient.
        if (typeof verifyNativeChatFocus !== 'function') {
          refuse('CHAT_FOCUS_BRIDGE_UNAVAILABLE', 'No native RIFT chat-focus bridge');
        }
        const proof = await verifyNativeChatFocus({ input, current, evidence });
        if (proof !== true) {
          refuse('CHAT_FOCUS_UNVERIFIED', 'Native RIFT chat caret/focus not proven');
        }
      }
      if (firstKeyStartedAt === null) firstKeyStartedAt = now();
      const reply = parseJson(await runner(args), 'WinApp send-input response');
      if (reply?.via !== 'send-input' || reply?.keys !== keys ||
          Number(reply?.hwnd) !== input.hwnd ||
          reply.actionCount !== 1 ||
          !Array.isArray(reply?.warnings) || reply.warnings.length !== 0 ||
          (reply.target !== undefined && reply.target !== null &&
            reply.target !== '' && reply.target !== 'RIFT' && reply.target !== 'Window' &&
             reply.target !== current.rootSelector)) {
        refuse('ACTION_RECOVERY_REQUIRED', 'Native keyboard delivery was not independently attributable');
      }
      // A stage ends with unsent text. Submission is deliberately separate.
    }
    return { submitted: true, sequenceCount: actions.length,
      targetPid: input.pid, targetHwnd: input.hwnd, senderSessionId: sessionId, focusPerformed: input.allowInitialFocus === true,
    };
  };
}


async function main(){
  let started=false;
  try{
    const request=parseCandidatesRequest(process.argv.slice(2));
    if(request.preflightOnly){
      const target=await inspectPhysicalRift(request);
      console.log(JSON.stringify({ok:true,readOnly:true,status:'PREFLIGHT_ONLY',
        inputSubmitted:false,target}));
      return;
    }
    // Deliberately block ALL LIVE game input. The installed capture adapter
    // reports foregroundMayChange=true, and current UIA exposes RIFT's top-level
    // window but not its custom chat-edit focus. Stage could leave stray text;
    // submit could press Enter in LuaPadModern. No trusted end-to-end bridge yet.
    // Once an independently verified bridge exists, review/replace this gate
    // and wire the new native focused-chat verifier before any live invocation.
    refuse('LIVE_FLOW_NOT_VALIDATED',
      'Prototype only: post-capture RIFT chat focus cannot yet be proven');
  }catch(error){
    console.log(JSON.stringify({ok:false,
      code:error?.code??'RIFT_OPERATION_FAILED',
      message:error?.message??'Unknown failure',
      inputSubmitted:started?'UNKNOWN_RECONCILE_PHASE_INTENT':false}));
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await main();
}
