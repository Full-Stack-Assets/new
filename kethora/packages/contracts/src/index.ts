import { z } from 'zod';

export const UUID = z.uuid();
export const ISODate = z.iso.datetime({ offset: true });
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/);

export const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user_url'), ref: z.url().startsWith('https://') }).strict(),
  z.object({ kind: z.literal('attachment'), ref: UUID }).strict(),
]);
export const acceptance = z.object({ id: z.string().min(1).max(80), verifier: z.enum(['artifact_open_and_hash', 'source_locator_review', 'event_resource_readback']), optional_until_approved: z.boolean().optional() }).strict();
export const TaskContract = z.object({
  schema_version: z.literal(1), outcome: z.string().min(1).max(4000), sources: z.array(source).max(20),
  acceptance: z.array(acceptance).min(1),
  allowed_operations: z.array(z.enum(['public_source_read','artifact_create','calendar_event_create_after_approval'])).max(3),
  cost_ceiling_usd: money, deadline_at: ISODate, task_revision: z.number().int().min(1),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.acceptance.map(a => a.id)).size !== value.acceptance.length) ctx.addIssue({code:'custom',message:'Duplicate acceptance ID'});
  if (value.sources.filter(s => s.kind === 'user_url').length > 10 || value.sources.filter(s => s.kind === 'attachment').length > 10) ctx.addIssue({code:'custom',message:'Source class limit exceeded'});
  if (Number(value.cost_ceiling_usd) > 2) ctx.addIssue({code:'custom',message:'Initial task limit is $2.00'});
});
export type TaskContract = z.infer<typeof TaskContract>;

export const Command = z.object({command_id: UUID, kind: z.enum(['create','revise','pause','resume','cancel','discussion']), text: z.string().max(4000), attachments: z.array(UUID).max(10), target_id: UUID.optional(), expected_revision: z.number().int().positive().optional()}).strict();
export type Command = z.infer<typeof Command>;
export const EventEnvelope = z.object({event_id: UUID,schema_version:z.literal(1),tenant_id:UUID,resource_kind:z.enum(['task','artifact','approval','invocation','source','monitor']),resource_id:UUID,resource_sequence:z.number().int().positive(),command_id:UUID.nullable(),causal_parent:UUID.nullable(),type:z.string().min(1),payload_ref:UUID.nullable(),committed_at:ISODate}).strict();
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export const Waiting = z.object({reason:z.enum(['approval','input','authentication','provider','device','budget','capacity']),responsible_party:z.enum(['user','provider','operator','system']),resume_condition:z.string().min(1),entered_at:ISODate,expires_at:ISODate.optional()}).strict();
export type Waiting = z.infer<typeof Waiting>;
export const TaskState = z.enum(['received','queued','planning','running','verifying','waiting','paused','needs_reconciliation','cancelling','completed','partial','failed','cancelled','expired']);
export type TaskState = z.infer<typeof TaskState>;

export const Locator = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('web'),source_version_id:UUID,quote:z.string().min(1),quote_hash:Hash,anchor:z.string().nullable()}).strict(),
  z.object({kind:z.literal('pdf'),source_version_id:UUID,file_hash:Hash,page:z.number().int().positive(),start:z.number().int().nonnegative(),end:z.number().int().positive(),quote:z.string().min(1),quote_hash:Hash}).strict(),
  z.object({kind:z.literal('text'),source_version_id:UUID,line:z.number().int().positive(),start:z.number().int().nonnegative(),end:z.number().int().positive(),quote:z.string().min(1),quote_hash:Hash}).strict(),
]);
export const SupportJudgment = z.object({schema_version:z.literal(1),claim_id:UUID,claim_text:z.string().min(1),source_version_id:UUID,source_hash:Hash,locator:Locator,label:z.enum(['supported','inference','disputed','missing']),rationale:z.string().min(1),judge_model_id:z.string().min(1),judge_prompt_version:z.string().min(1),judged_at:ISODate,task_revision:z.number().int().positive(),is_simulated:z.boolean()}).strict();
export type SupportJudgment = z.infer<typeof SupportJudgment>;

export const OneOffEvent = z.object({calendar_id:z.string().min(1),title:z.string().min(1).max(255),description:z.string().max(5000),start:ISODate,end:ISODate,iana_zone:z.string().min(1),attendees:z.array(z.email()).max(25),uid:z.string().min(1),account_id:UUID}).strict().superRefine((v,ctx)=>{
  if (Date.parse(v.start)>=Date.parse(v.end))ctx.addIssue({code:'custom',message:'End must follow start'});
  try { new Intl.DateTimeFormat('en',{timeZone:v.iana_zone}); } catch { ctx.addIssue({code:'custom',message:'Invalid IANA time zone'}); }
});
export type OneOffEvent = z.infer<typeof OneOffEvent>;
export const ApprovalPayload = z.object({schema_version:z.literal(1),effect_key:UUID,connection_id:UUID,server_class:z.string().min(1),calendar_account_id:UUID,destination:z.string().min(1),event:OneOffEvent,data_sent:z.array(z.string()).min(1),expires_at:ISODate,task_revision:z.number().int().positive()}).strict();
export type ApprovalPayload = z.infer<typeof ApprovalPayload>;

export type CalendarStatus = 'writable_tested'|'read_only'|'insufficient_scope'|'expired'|'revoked'|'temporarily_unavailable'|'unsupported';
export interface CalendarAdapter {
  readonly providerClass: string;
  listCalendars(connectionId: string): Promise<readonly {id:string; name:string}[]>;
  probeCapabilities(connectionId: string): Promise<{status:CalendarStatus; fixturePassed:boolean; livePassed:boolean; observedAt:string}>;
  prepareOneOffEvent(effectKey: string, event: OneOffEvent): Promise<{stableKey:string; payloadDigest:string; canonicalEvent:OneOffEvent}>;
  create(stableKey: string, event: OneOffEvent): Promise<{providerRef?:string; ambiguous:boolean}>;
  readByStableKey(stableKey: string): Promise<OneOffEvent|null>;
  reconcile(stableKey: string, expected: OneOffEvent): Promise<'confirmed'|'uncertain'>;
  disconnect(connectionId: string): Promise<void>;
}

export const operationRegistry = Object.freeze({
  public_source_read:{risk:'low',effect:'read',approval:false,verification:'source_hash',destination:'approved_https_url'},
  artifact_create:{risk:'low',effect:'local_artifact',approval:false,verification:'artifact_open_and_hash',destination:'private_object_store'},
  calendar_event_create_after_approval:{risk:'high',effect:'external_write',approval:true,verification:'event_resource_readback',destination:'tested_account_and_calendar'},
} as const);
export function operationIsRegistered(s:string):s is keyof typeof operationRegistry {return Object.hasOwn(operationRegistry,s);}
