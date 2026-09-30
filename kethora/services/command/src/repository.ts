import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {Command,TaskContract,type EventEnvelope} from '../../../packages/contracts/src/index.js';
import {digest} from '../../broker/src/permit.js';

export type VerifiedPrincipal={tenantId:string;deviceId:string;sessionId:string;stepUpAt?:number};
// Only identity service may construct this after passkey/session verification. API has no anonymous fallback.
export class CommandRepository {
  constructor(private readonly pool:pg.Pool){}
  async createTask(principal:VerifiedPrincipal,input:unknown,contractInput:unknown):Promise<{command_id:string;task_id:string;event_cursor:number;duplicate:boolean}>{
    const command=Command.parse(input),contract=TaskContract.parse(contractInput);
    if(command.kind!=='create'||command.target_id||contract.task_revision!==1||Date.parse(contract.deadline_at)<=Date.now())throw new Error('Invalid admission');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('kethora.tenant_id',$1,true)",[principal.tenantId]);
      const account=await client.query("SELECT policy_epoch FROM kethora.account WHERE tenant_id=$1 AND status='active' FOR UPDATE",[principal.tenantId]);
      if(!account.rowCount)throw new Error('Account unavailable');
      const prior=await client.query('SELECT payload_digest,result FROM kethora.command WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[principal.tenantId,command.command_id]);
      const inputDigest=digest({command,contract});
      if(prior.rowCount){
        if(prior.rows[0].payload_digest!==inputDigest)throw new Error('Idempotency key reused with changed payload');
        await client.query('COMMIT');return {...prior.rows[0].result,duplicate:true};
      }
      const taskId=randomUUID(),eventId=randomUUID();
      const cents=Math.round(Number(contract.cost_ceiling_usd)*100);
      await client.query('INSERT INTO kethora.task(tenant_id,id,contract,cost_ceiling_cents,deadline_at,policy_epoch) VALUES($1,$2,$3,$4,$5,$6)',[principal.tenantId,taskId,contract,cents,contract.deadline_at,account.rows[0].policy_epoch]);
      const event:EventEnvelope={event_id:eventId,schema_version:1,tenant_id:principal.tenantId,resource_kind:'task',resource_id:taskId,resource_sequence:1,command_id:command.command_id,causal_parent:null,type:'task.received',payload_ref:null,committed_at:new Date().toISOString()};
      await client.query('INSERT INTO kethora.event(tenant_id,id,schema_version,resource_kind,resource_id,resource_sequence,command_id,causal_parent,type,payload_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[event.tenant_id,event.event_id,event.schema_version,event.resource_kind,event.resource_id,event.resource_sequence,event.command_id,event.causal_parent,event.type,event.payload_ref]);
      await client.query('UPDATE kethora.task SET event_position=1 WHERE tenant_id=$1 AND id=$2',[principal.tenantId,taskId]);
      await client.query('INSERT INTO kethora.outbox(tenant_id,event_id,delivery_key) VALUES($1,$2,$3)',[principal.tenantId,eventId,`task:${taskId}:1`]);
      const result={command_id:command.command_id,task_id:taskId,event_cursor:1,duplicate:false};
      await client.query('INSERT INTO kethora.command(tenant_id,id,kind,actor_device_id,payload_digest,result) VALUES($1,$2,$3,$4,$5,$6)',[principal.tenantId,command.command_id,command.kind,principal.deviceId,inputDigest,result]);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
