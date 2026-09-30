import {condition,continueAsNew,defineSignal,proxyActivities,setHandler} from '@temporalio/workflow';

// Only opaque IDs appear in Temporal history. PostgreSQL owns state, approval and policy.
const wake=defineSignal<[string]>('committedEvent');
interface Activities {inspectCommittedEvent(tenantId:string,taskId:string,eventId:string):Promise<{eventPosition:number;terminal:boolean}>;}
const activities=proxyActivities<Activities>({startToCloseTimeout:'20 seconds',retry:{maximumAttempts:3}});
export async function taskCoordinator(tenantId:string,taskId:string,lastPosition=0):Promise<void>{
  const pending:string[]=[];
  setHandler(wake,(id:string)=>{if(!pending.includes(id))pending.push(id);});
  let accepted=0;
  while(true){
    await condition(()=>pending.length>0);
    const eventId=pending.shift()!;
    const state=await activities.inspectCommittedEvent(tenantId,taskId,eventId);
    if(state.eventPosition<=lastPosition)continue;
    if(state.eventPosition!==lastPosition+1)throw new Error('Projection gap: stop and reconcile from product event journal');
    lastPosition=state.eventPosition;accepted++;
    if(state.terminal)return;
    if(accepted>=100)await continueAsNew<typeof taskCoordinator>(tenantId,taskId,lastPosition);
  }
}
