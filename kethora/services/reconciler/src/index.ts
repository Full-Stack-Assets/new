import type {CalendarAdapter,OneOffEvent} from '../../../packages/contracts/src/index.js';
export type Invocation = {effectKey:string;stableKey:string;state:'prepared'|'dispatching'|'uncertain'|'confirmed'|'unresolved';readAttempts:number;lastObservedAt?:string};
export async function reconcileReadOnly(invocation:Invocation,expected:OneOffEvent,adapter:CalendarAdapter):Promise<Invocation>{
  if(!['dispatching','uncertain'].includes(invocation.state))throw new Error('Not a claimed effect');
  // Never call create() from a reconciling path.
  let state:'confirmed'|'uncertain'='uncertain';
  try {state=await adapter.reconcile(invocation.stableKey,expected);}catch {state='uncertain';}
  return {...invocation,state:state==='confirmed'?'confirmed':invocation.readAttempts>=2?'unresolved':'uncertain',readAttempts:invocation.readAttempts+1,lastObservedAt:new Date().toISOString()};
}
