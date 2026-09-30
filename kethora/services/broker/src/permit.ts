import {createHash,createPrivateKey,createPublicKey,sign,verify,timingSafeEqual} from 'node:crypto';
import {operationIsRegistered,operationRegistry} from '../../../packages/contracts/src/index.js';

function ordered(value:unknown):unknown {
  if(Array.isArray(value))return value.map(ordered);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)]));
  return value;
}
export function canonical(value:unknown):string {return JSON.stringify(ordered(value));}
export function digest(value:unknown):string {return createHash('sha256').update(canonical(value)).digest('hex');}
export type PermitFields = {tenant_id:string;task_id:string;run_id:string;step_id:string;effect_key:string;payload_digest:string;operation:string;account_id:string;destination:string;scope:string;policy_revision:number;revocation_epoch:number;fence:number;issued_at:number;expires_at:number};
export type SignedPermit = {fields:PermitFields;signature:string};
export type LiveClaim = {tenant_id:string;task_id:string;run_id:string;step_id:string;effect_key:string;payload_digest:string;operation:string;account_id:string;destination:string;scope:string;policy_revision:number;revocation_epoch:number;fence:number;taskRevisionCurrent:boolean;approvedDigest:string;approvalActive:boolean;connectionWritableLiveTested:boolean;cancelled:boolean;measuredSkewMs:number|null;now:number};

export function issue(fields:PermitFields,keyPem:string):SignedPermit {
  if(!operationIsRegistered(fields.operation)||!operationRegistry[fields.operation].approval)throw new Error('Only reviewed exact effect permitted');
  if(fields.expires_at<=fields.issued_at||fields.expires_at-fields.issued_at>60_000)throw new Error('Permit TTL outside maximum');
  return {fields,signature:sign(null,Buffer.from(canonical(fields)),createPrivateKey(keyPem)).toString('base64url')};
}
export function authorizeClaim(permit:SignedPermit,live:LiveClaim,publicKeyPem:string):void {
  const f=permit.fields;
  if(!verify(null,Buffer.from(canonical(f)),createPublicKey(publicKeyPem),Buffer.from(permit.signature,'base64url')))throw new Error('Invalid permit signature');
  if(live.measuredSkewMs===null||Math.abs(live.measuredSkewMs)>2000)throw new Error('Unknown or excessive clock skew');
  if(live.now<f.issued_at-2000||live.now>=f.expires_at)throw new Error('Permit expired or not yet issued');
  for(const key of ['tenant_id','task_id','run_id','step_id','effect_key','payload_digest','operation','account_id','destination','scope','policy_revision','revocation_epoch','fence'] as const)if(f[key]!==live[key])throw new Error(`Permit ${key} mismatch`);
  if(!live.taskRevisionCurrent||!live.approvalActive||!live.connectionWritableLiveTested||live.cancelled)throw new Error('Live authorization guard failed');
  if(!/^[a-f0-9]{64}$/.test(live.approvedDigest)||!timingSafeEqual(Buffer.from(f.payload_digest,'hex'),Buffer.from(live.approvedDigest,'hex')))throw new Error('Approved payload changed');
}
