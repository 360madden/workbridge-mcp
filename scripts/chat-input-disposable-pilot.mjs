// Disposable TextProbe only: fixed three-stage WinApp send-input test; never targets RIFT.
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDesktopAdmission } from './desktop-turn-admission.mjs';
import { runWinapp } from './desktop-ui.mjs';
import { sendDisposableChatPhaseOnce } from './chat-input-disposable-phase.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('..', import.meta.url));
const root = path.join(repo, '.tools', 'desktop-evidence');
const evidence = path.join(repo, '.tools', 'chatinput-probe-evidence-20261105a');
const title = 'Workbridge RIFT Chat Input Disposable Probe';
const initial = JSON.parse(await runWinapp(['ui','list-windows','-a','ChatInputProbe','--json']));
const matches = initial.filter(w => w.processName === 'ChatInputProbe' && w.title === title && String(w.className).startsWith('WindowsForms10.Window.') && Number(w.ownerHwnd ?? 0) === 0 && w.width >= 700 && w.height >= 350);
if (matches.length !== 1) throw Error('DISPOSABLE_WINDOW_NOT_UNIQUE');
const pid = Number(matches[0].processId);
const hwnd = Number(matches[0].hwnd);
const observedClass = matches[0].className;
if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(hwnd) || pid <= 0 || hwnd <= 0) throw Error('INVALID_WINDOW_ID');
const evidenceLog = path.join(evidence, 'native-chat-' + pid + '.jsonl');
const lockPath = path.join(root, 'desktop-input-turn.lock');
const requestId = 'chatinput_probe_threephase_20261105c';
const readLog = async () => {
  const raw = await readFile(evidenceLog,'utf8');
  return raw.trim().split(/\r?\n/).map(x=>JSON.parse(x));
};
const getProcess = async () => {
  const ps = "$p=Get-Process -Id " + pid + " -ErrorAction Stop; [pscustomobject]@{pid=$p.Id;session=$p.SessionId;start=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress";
  const {stdout} = await exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',ps],{timeout:10000,windowsHide:true});
  return JSON.parse(stdout);
};
const identity = await getProcess();
if(identity.pid!==pid || !Number.isInteger(identity.session) || identity.session!==1)throw Error('WRONG_SESSION');
async function assertTarget() {
  const p=await getProcess();
  if(p.pid!==identity.pid || p.session!==identity.session || p.start!==identity.start) throw Error('PROCESS_REUSED');
  const win=JSON.parse(await runWinapp(['ui','list-windows','-a',String(pid),'--json']));
  const w=win.find(x=>Number(x.hwnd)===hwnd);
  if(!w || w.processName!=='ChatInputProbe' || w.title!==title || w.className!==observedClass ||
     !w.isForeground || w.width<700 || w.height<350) throw Error('WRONG_WINDOW_OR_NOT_FOREGROUND');
  const tree=JSON.parse(await runWinapp(['ui','inspect','-w',String(hwnd),'--depth','1','--json']));
  const e=tree?.windows?.find(x=>Number(x.hwnd)===hwnd)?.elements?.[0];
  if(e?.type!=='Window' || e.name!==title || e.className!==observedClass ||
      e.isEnabled!==true || e.isOffscreen===true ||
      ![e.x,e.y,e.width,e.height].every(Number.isFinite) ||
      e.width<700 || e.height<350 || Math.abs(e.width-w.width)>60 || Math.abs(e.height-w.height)>60) {
    throw Error('ROOT_WINDOW_GEOMETRY_CHANGED');
  }
  const latest=JSON.parse(await runWinapp(['ui','list-windows','-a',String(pid),'--json']));
  const still=latest.find(x=>Number(x.hwnd)===hwnd);
  if(!still || still.isForeground!==true || still.className!==observedClass || still.processName!=='ChatInputProbe') {
    throw Error('WINDOW_LOST_FOCUS_BEFORE_PHASE');
  }
}
const hash=b=>createHash('sha256').update(b).digest('hex');
await withDesktopAdmission(lockPath,{producer:'chatinput-probe-test',requestId},async()=>{
  const names=await readdir(root);
  if(names.some(x=>x.startsWith('desktop-turn-quarantine-')) || names.includes('desktop-input-turn.lock'))throw Error('LOCK_OR_QUARANTINE');
  const h=await open(lockPath,'wx'); const stamp=Buffer.from(JSON.stringify({schemaVersion:1,kind:'workbridge.gui-turn',leaseId:randomUUID(),producer:'chatinput-probe-test',requestId,owner:{pid:process.pid},target:{kind:'window',pid,hwnd,process:'ChatInputProbe'},acquiredUtc:new Date().toISOString()})+'\n');
  await h.writeFile(stamp); await h.sync(); await h.close();
  const intentPath=path.join(evidence,'chatinput-threephase-c.intent.json');
  const ih=await open(intentPath,'wx');await ih.writeFile(JSON.stringify({requestId,pid,hwnd,kind:'disposable-chat',phase:'started'})+'\n');await ih.sync();await ih.close();
  let started=false;
  try {
    const tree=JSON.parse(await runWinapp(['ui','inspect','-w',String(hwnd),'--depth','1','--json']));
    const rootElement=tree?.windows?.find(w=>Number(w.hwnd)===hwnd)?.elements?.[0];
    if(rootElement?.type!=='Window' || !String(rootElement?.selector||'').startsWith('win-') || rootElement?.isOffscreen || rootElement?.isEnabled!==true) throw Error('NO_SAFE_DISPOSABLE_FOCUS');
    await runWinapp(['ui','focus',rootElement.selector,'-w',String(hwnd),'--json']);
    await assertTarget();
    let logs=await readLog();
    if(logs.some(e=>e.stage!=='shown') || logs.length!==1 || logs[0].chatOpen)throw Error('NONEMPTY_DISPOSABLE_CHAT');
    const phases=[
      {arg:['enter'],expected:'opened'},
      {arg:['/reloadui','--verbatim'],expected:'typed'},
      {arg:['enter'],expected:'submitted'},
    ];
    let typedCount=0;
    for(const phase of phases){
      const outcome=await sendDisposableChatPhaseOnce({
        phase:phase.expected,
        assertTarget,
        readEvents:readLog,
        timeoutMs:3000,
        intervalMs:40,
        sendExactlyOnce:async()=>{
          started=true;
          const response=JSON.parse(await runWinapp(['ui','send-keys',...phase.arg,'-w',String(hwnd),'--via','send-input','--json']));
          if(response.hwnd && Number(response.hwnd)!==hwnd)throw Error('WRONG_RETURN_HWND');
          return response;
        },
      });
      typedCount=outcome.verified.typedCount;
    }
    await writeFile(path.join(evidence,'chatinput-threephase-c.receipt.json'),JSON.stringify({requestId,pid,hwnd,ok:true,exactSubmission:true,phaseCount:3,typedCount})+'\n',{flag:'wx'});
    const prior=await readFile(lockPath);
    if(hash(prior)!==hash(stamp))throw Error('LOCK_CHANGED');
    const {unlink}=await import('node:fs/promises');
    await unlink(lockPath);
    console.log(JSON.stringify({ok:true,requestId,pid,hwnd,exactSubmission:true,phaseCount:3,typedCount}));
  }catch(e){
    console.log(JSON.stringify({ok:false,reason:e.message,started,lockRetained:true}));
    throw e;
  }
});
