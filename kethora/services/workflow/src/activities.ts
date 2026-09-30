import type pg from 'pg';
// This service identity can read scoped product events but cannot dispatch tools.
export function eventReader(pool:pg.Pool){return async(tenantId:string,taskId:string,eventId:string):Promise<{eventPosition:number;terminal:boolean}>=>{
 const client=await pool.connect();try{
  await client.query('BEGIN');await client.query("SELECT set_config('kethora.tenant_id',$1,true)",[tenantId]);
  const result=await client.query(`SELECT e.resource_sequence,e.type,t.event_position,t.state FROM kethora.event e JOIN kethora.task t ON t.tenant_id=e.tenant_id AND t.id=e.resource_id WHERE e.tenant_id=$1 AND e.id=$2 AND e.resource_kind='task' AND e.resource_id=$3`,[tenantId,eventId,taskId]);
  if(result.rowCount!==1)throw Error('Committed event is absent or outside the scoped task');
  const row=result.rows[0];await client.query('COMMIT');
  return {eventPosition:Number(row.resource_sequence),terminal:Number(row.resource_sequence)===Number(row.event_position)&&['completed','partial','failed','cancelled','expired'].includes(row.state)};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
};}
