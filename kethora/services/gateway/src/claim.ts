import type pg from 'pg';
import {verify,createPublicKey} from 'node:crypto';
import {authorizeClaim,canonical,type LiveClaim,type SignedPermit} from '../../broker/src/permit.js';

// Gateway has the verification key only. Caller must have authenticated service identity;
// this function only creates a dispatch claim, never performs provider I/O in the transaction.
export async function claimExactEffect(client:pg.PoolClient,permit:SignedPermit,publicKeyPem:string,observed:{now:number;skewMs:number|null}):Promise<'claimed'|'already_claimed'>{
  const f=permit.fields;
  if(!verify(null,Buffer.from(canonical(f)),createPublicKey(publicKeyPem),Buffer.from(permit.signature,'base64url')))throw new Error('Invalid permit signature');
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('kethora.tenant_id',$1,true)",[f.tenant_id]);
    const row=await client.query(`SELECT i.state,i.payload_digest,i.fence,i.operation,i.effect_key,i.task_id,i.task_revision,
      i.run_id,i.step_id,i.destination,i.scope,i.policy_revision,
      t.revision,t.state AS task_state,t.deadline_at,t.policy_epoch AS task_epoch,
      owner.policy_epoch AS owner_epoch,owner.status AS owner_status,
      r.task_revision AS run_revision,r.state AS run_state,
      step.lease_fence AS live_step_fence,step.lease_expires_at,step.state AS step_state,
      a.id AS approval_id,a.account_id,a.task_revision AS approval_revision,a.effect_key AS approval_effect_key,a.decision,a.payload_digest AS approved_digest,a.expires_at AS approval_expiry,a.consumed_at,a.policy_epoch AS approval_epoch,
      c.capability_status,c.live_passed,c.fixture_passed,c.revoked_at,c.policy_epoch AS connection_epoch
      FROM kethora.invocation i JOIN kethora.task t ON t.tenant_id=i.tenant_id AND t.id=i.task_id
      JOIN kethora.run r ON r.tenant_id=i.tenant_id AND r.id=i.run_id
      JOIN kethora.step step ON step.tenant_id=i.tenant_id AND step.id=i.step_id AND step.run_id=i.run_id
      JOIN kethora.approval a ON a.tenant_id=i.tenant_id AND a.id=i.approval_id
      JOIN kethora.connection c ON c.tenant_id=i.tenant_id AND c.id=a.account_id
      JOIN kethora.account owner ON owner.tenant_id=i.tenant_id
      WHERE i.tenant_id=$1 AND i.effect_key=$2 FOR UPDATE OF i,t,r,step,a,c,owner`,[f.tenant_id,f.effect_key]);
    if(row.rowCount!==1)throw new Error('Invocation missing');
    const v=row.rows[0];
    if(v.state==='dispatching'||v.state==='uncertain'||v.state==='confirmed'){
      await client.query('COMMIT');return 'already_claimed'; // No provider dispatch on this result.
    }
    const live:LiveClaim={...f,task_id:v.task_id,run_id:v.run_id,step_id:v.step_id,destination:v.destination,scope:v.scope,
      policy_revision:v.policy_revision,account_id:v.account_id,
      now:observed.now,measuredSkewMs:observed.skewMs,
      taskRevisionCurrent:Number(v.revision)===v.task_revision&&v.run_revision===v.task_revision&&v.approval_revision===v.task_revision&&new Date(v.deadline_at).getTime()>observed.now,
      approvedDigest:v.approved_digest,approvalActive:v.decision==='approved'&&!v.consumed_at&&new Date(v.approval_expiry).getTime()>observed.now,
      connectionWritableLiveTested:v.capability_status==='writable_tested'&&v.fixture_passed&&v.live_passed&&!v.revoked_at,
      cancelled:!['running','verifying'].includes(v.task_state)||v.owner_status!=='active'||v.run_state!=='running'||v.step_state!=='running'};
    if(v.state!=='prepared'||v.approval_effect_key!==f.effect_key||v.payload_digest!==f.payload_digest||Number(v.fence)!==f.fence||Number(v.live_step_fence)!==f.fence||!v.lease_expires_at||new Date(v.lease_expires_at).getTime()<=observed.now||v.operation!==f.operation||v.effect_key!==f.effect_key||Number(v.task_epoch)!==f.revocation_epoch||Number(v.owner_epoch)!==f.revocation_epoch||Number(v.approval_epoch)!==f.revocation_epoch||Number(v.connection_epoch)!==f.revocation_epoch)throw new Error('Authoritative invocation mismatch');
    authorizeClaim(permit,live,publicKeyPem);
    await client.query("UPDATE kethora.invocation SET state='dispatching',claimed_at=now() WHERE tenant_id=$1 AND effect_key=$2",[f.tenant_id,f.effect_key]);
    await client.query('UPDATE kethora.approval SET consumed_at=now() WHERE tenant_id=$1 AND id=(SELECT approval_id FROM kethora.invocation WHERE tenant_id=$1 AND effect_key=$2)',[f.tenant_id,f.effect_key]);
    await client.query('COMMIT');return 'claimed';
  }catch(e){await client.query('ROLLBACK');throw e;}
}
