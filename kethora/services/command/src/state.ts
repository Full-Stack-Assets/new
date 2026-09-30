import type { TaskState, Waiting } from '../../../packages/contracts/src/index.js';

const transitions: Readonly<Record<TaskState,readonly TaskState[]>> = {
  received:['queued','waiting','cancelled'], queued:['planning','paused','cancelling','expired'],
  planning:['running','waiting','paused','cancelling','failed','expired'],
  running:['verifying','waiting','paused','needs_reconciliation','cancelling','partial','failed','expired'],
  verifying:['completed','partial','waiting','needs_reconciliation','cancelling','failed','expired'],
  waiting:['queued','planning','running','verifying','paused','cancelling','expired'],
  paused:['queued','planning','running','cancelling','expired'],
  needs_reconciliation:['verifying','cancelling','expired'], cancelling:['cancelled','needs_reconciliation'],
  completed:[], partial:[], failed:[], cancelled:[], expired:[],
};
export type Projection = {state:TaskState;revision:number;eventPosition:number;wait?:Waiting;deadlineExceeded:boolean;uncertainEffects:number};
export function transition(current: Projection, next: TaskState, eventPosition:number, options:{wait?:Waiting;receiptCommitted?:boolean;acceptanceVerified?:boolean;outcomeRecorded?:boolean} = {}):Projection {
  if(eventPosition !== current.eventPosition+1)throw new Error('Event position mismatch; reconcile from event journal');
  if(!transitions[current.state].includes(next))throw new Error(`Illegal transition ${current.state} → ${next}`);
  if(next==='waiting'&&!options.wait)throw new Error('Waiting requires full resume metadata');
  if(next==='completed'&&(!options.receiptCommitted||!options.acceptanceVerified||current.uncertainEffects))throw new Error('Completion requires receipt and current evidence');
  if(next==='expired'&&(current.uncertainEffects>0||!options.outcomeRecorded||!options.receiptCommitted))throw new Error('Expiry cannot hide uncertain effects');
  if(next==='cancelled'&&current.uncertainEffects>0)throw new Error('Cancellation cannot hide uncertain effects');
  const result:Projection={...current,state:next,eventPosition};
  if(options.wait)result.wait=options.wait;else delete result.wait;
  return result;
}
export function canClaim(task:Projection, revision:number,now:number,deadline:number):boolean {
  return task.revision===revision && !task.deadlineExceeded && now<deadline && ['queued','planning','running','verifying'].includes(task.state);
}
export function revise(task:Projection,expectedRevision:number):Projection {
  if(task.revision!==expectedRevision)throw new Error('revision_conflict');
  if(['completed','failed','expired','cancelled'].includes(task.state))throw new Error('Terminal task; start successor');
  return {...task,revision:task.revision+1};
}
