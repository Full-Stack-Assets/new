import type pg from 'pg';
import type {Client} from '@temporalio/client';
// One configured tenant scope per relay batch. No privileged account enumeration.
// Signal failure leaves the outbox pending; duplicate signals are normal.
export async function relayOutbox(pool:pg.Pool,temporal:Client,tenantId:string):Promise<number>{
 const client=await pool.connect();try{
  await client.query('BEGIN');await client.query("SELECT set_config('kethora.tenant_id',$1,true)",[tenantId]);
  const result=await client.query(`SELECT o.id,e.id AS event_id,e.resource_id FROM kethora.outbox o JOIN kethora.event e ON e.tenant_id=o.tenant_id AND e.id=o.event_id WHERE o.tenant_id=$1 AND o.delivered_at IS NULL AND e.resource_kind='task' ORDER BY e.resource_sequence FOR UPDATE OF o SKIP LOCKED LIMIT 50`,[tenantId]);
  for(const row of result.rows){await temporal.workflow.signalWithStart('taskCoordinator',{workflowId:`task:${tenantId}:${row.resource_id}`,taskQueue:'kethora-task-v1',args:[tenantId,row.resource_id,0],signal:'committedEvent',signalArgs:[row.event_id],workflowExecutionTimeout:'30 days'});await client.query('UPDATE kethora.outbox SET delivered_at=now(),attempts=attempts+1 WHERE tenant_id=$1 AND id=$2',[tenantId,row.id]);}
  await client.query('COMMIT');return result.rows.length;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
