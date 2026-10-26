import { AgentCoordination } from './agent-coordination.js';
import type { Workspace } from './workspace.js';

export {
  agentAssignmentStates,
  agentAssignSchema,
  agentReceiptSchema,
  MAX_AGENT_WORKERS,
} from './agent-coordination.js';

export type AgentAssignment = Awaited<ReturnType<AgentCoordination['assign']>>;
export type AgentAssignmentState = AgentAssignment['state'];
export const agentWorkerStatuses = ['idle', 'queued', 'review', 'blocked', 'running'] as const;
export type AgentWorkerStatus = (typeof agentWorkerStatuses)[number];
export type AgentWorker = {
  workerId: string;
  status: AgentWorkerStatus;
  runningTaskId: string | null;
  tasks: Record<AgentAssignmentState, string[]>;
};
export type AgentFileOwner = {
  path: string;
  taskId: string;
  workerId: string;
  state: Exclude<AgentAssignmentState, 'verified'>;
};

const pathKey = (file: string) => file.replaceAll('\\', '/').toLowerCase();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Thin metadata API over the existing coordination journal, not another scheduler.
 *
 * Inherited assign/dispatch/dispatchNext/finish/verify operations retain the existing
 * exclusive file lock, atomic publication, pinned HEAD, job settlement and replay
 * checks. Task transitions are queued -> running -> review -> verified, or running
 * -> blocked. Only verified tasks release their paths. Blocked tasks retain ownership
 * for explicit coordinator recovery; this API never steals locks or retries jobs.
 *
 * Supply the SAME workspace, storage directory, Jobs.status reader and HEAD reader
 * used by AgentCoordination. Both APIs may safely share that one journal. Nothing is
 * started at construction, and no job is launched, cancelled or modified here.
 */
export class AgentAssignments extends AgentCoordination {
  private assignmentWorkspace: Workspace;

  constructor(...args: ConstructorParameters<typeof AgentCoordination>) {
    super(...args);
    this.assignmentWorkspace = args[0];
  }

  /** One locked, validated snapshot. Worker status is derived from durable task
   * metadata, not a heartbeat or proof that a worker process is alive. Precedence is
   * running > blocked > review > queued > idle; all tasks remain visible by state.
   * A worker with only verified tasks is idle. Returned objects are caller-owned.
   */
  async status() {
    const snapshot = await this.list();
    const workers = new Map<string, AgentWorker>();
    const owners: AgentFileOwner[] = [];
    for (const task of snapshot.tasks) {
      let worker = workers.get(task.workerId);
      if (!worker) {
        worker = {
          workerId: task.workerId,
          status: 'idle',
          runningTaskId: null,
          tasks: { queued: [], running: [], review: [], verified: [], blocked: [] },
        };
        workers.set(task.workerId, worker);
      }
      worker.tasks[task.state].push(task.taskId);
      if (task.state === 'running') worker.runningTaskId = task.taskId;
      if (
        task.state !== 'verified' &&
        agentWorkerStatuses.indexOf(task.state) > agentWorkerStatuses.indexOf(worker.status)
      )
        worker.status = task.state;
      if (task.state !== 'verified') {
        for (const file of task.ownedPaths)
          owners.push({ path: file, taskId: task.taskId, workerId: task.workerId, state: task.state });
      }
    }
    return {
      ...snapshot,
      workers: [...workers.values()].sort((a, b) => compare(a.workerId, b.workerId)),
      owners: owners.sort((a, b) => compare(pathKey(a.path), pathKey(b.path))),
    };
  }

  /** Exact-file ownership at the returned journal revision. Uses the same workspace
   * path boundaries as assignment, including missing files and case aliases. This is
   * an advisory metadata snapshot, not a filesystem write lease or authorization.
   * Always use assign to reserve paths atomically; do not check then write/assign.
   */
  async ownerOf(file: string) {
    const target = await this.assignmentWorkspace.historyPath(file);
    const snapshot = await this.status();
    return {
      revision: snapshot.revision,
      path: target,
      owner: snapshot.owners.find((owner) => pathKey(owner.path) === pathKey(target)) ?? null,
    };
  }
}
