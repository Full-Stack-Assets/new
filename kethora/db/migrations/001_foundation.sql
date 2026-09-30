-- Forward-only. Apply using a dedicated migration role, never an agent workload.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS kethora;
CREATE TABLE kethora.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), sha256 text NOT NULL);

CREATE TABLE kethora.account (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_email_ciphertext bytea,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hold','resetting','deleted')),
  home_region text NOT NULL DEFAULT 'us-east-1', deletion_generation bigint NOT NULL DEFAULT 0,
  policy_epoch bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kethora.device (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  credential_public_key bytea NOT NULL, credential_id bytea NOT NULL, counter bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(credential_id)
);
CREATE TABLE kethora.session (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL, token_verifier bytea NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,device_id) REFERENCES kethora.device(tenant_id,id)
);
CREATE TABLE kethora.recovery_code (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  verifier bytea NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE kethora.task (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), state text NOT NULL DEFAULT 'received',
  contract jsonb NOT NULL, cost_ceiling_cents integer NOT NULL CHECK(cost_ceiling_cents>=0),
  reserved_cents integer NOT NULL DEFAULT 0 CHECK(reserved_cents>=0), spent_cents integer NOT NULL DEFAULT 0 CHECK(spent_cents>=0),
  inference_turns integer NOT NULL DEFAULT 0 CHECK(inference_turns BETWEEN 0 AND 12), replans integer NOT NULL DEFAULT 0 CHECK(replans BETWEEN 0 AND 2),
  deadline_at timestamptz NOT NULL, wait jsonb, deadline_exceeded boolean NOT NULL DEFAULT false,
  event_position bigint NOT NULL DEFAULT 0, policy_epoch bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id), CHECK (state <> 'waiting' OR wait IS NOT NULL)
);
CREATE INDEX task_runnable ON kethora.task(state,updated_at) WHERE state IN('queued','planning','running','verifying');
CREATE INDEX task_waiting ON kethora.task(state,updated_at) WHERE state IN('waiting','needs_reconciliation');
CREATE TABLE kethora.command (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL, kind text NOT NULL,
  target_id uuid, expected_revision integer, actor_device_id uuid, payload_ref uuid, payload_digest text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(), result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE kethora.event (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  schema_version integer NOT NULL, resource_kind text NOT NULL, resource_id uuid NOT NULL,
  resource_sequence bigint NOT NULL, command_id uuid, causal_parent uuid, type text NOT NULL,
  payload_ref uuid, committed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,resource_kind,resource_id,resource_sequence)
);
CREATE INDEX event_owner_cursor ON kethora.event(tenant_id,committed_at,id);
CREATE TABLE kethora.outbox (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL, delivery_key text NOT NULL, attempts integer NOT NULL DEFAULT 0,
  delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,delivery_key),
  FOREIGN KEY(tenant_id,event_id) REFERENCES kethora.event(tenant_id,id)
);
CREATE INDEX outbox_pending ON kethora.outbox(created_at) WHERE delivered_at IS NULL;
CREATE TABLE kethora.inbox (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), consumer text NOT NULL, event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,consumer,event_id)
);
CREATE TABLE kethora.run (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  task_id uuid NOT NULL, task_revision integer NOT NULL, workflow_id text NOT NULL,
  worker_deployment text, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,task_id) REFERENCES kethora.task(tenant_id,id)
);
CREATE TABLE kethora.step (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL, run_id uuid NOT NULL,
  capability text NOT NULL, input_digest text NOT NULL, dependencies uuid[] NOT NULL DEFAULT '{}',
  state text NOT NULL, lease_fence bigint NOT NULL DEFAULT 0, lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,run_id) REFERENCES kethora.run(tenant_id,id)
);
CREATE INDEX step_expired_lease ON kethora.step(lease_expires_at) WHERE state='running';

CREATE TABLE kethora.connection (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  provider text NOT NULL, server_class text NOT NULL, provider_account_id text NOT NULL,
  calendar_id text NOT NULL, bound_host text, secret_ref uuid, scopes text[] NOT NULL DEFAULT '{}',
  capability_status text NOT NULL DEFAULT 'read_only', fixture_passed boolean NOT NULL DEFAULT false,
  live_passed boolean NOT NULL DEFAULT false, probe_at timestamptz,
  policy_epoch bigint NOT NULL DEFAULT 1, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), CHECK (capability_status <> 'writable_tested' OR (fixture_passed AND live_passed AND probe_at IS NOT NULL AND revoked_at IS NULL))
);
CREATE TABLE kethora.grant (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  connection_id uuid, operation text NOT NULL, scope jsonb NOT NULL, policy_revision integer NOT NULL,
  revocation_epoch bigint NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,connection_id) REFERENCES kethora.connection(tenant_id,id)
);
CREATE TABLE kethora.approval (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  task_id uuid NOT NULL, task_revision integer NOT NULL, effect_key uuid NOT NULL,
  account_id uuid NOT NULL, payload_ref uuid NOT NULL, payload_digest text NOT NULL,
  policy_epoch bigint NOT NULL, expires_at timestamptz NOT NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK(decision IN('pending','approved','denied','expired','invalidated')),
  decided_at timestamptz, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,effect_key,payload_digest),
  FOREIGN KEY(tenant_id,task_id) REFERENCES kethora.task(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES kethora.connection(tenant_id,id)
);
CREATE TABLE kethora.invocation (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  effect_key uuid NOT NULL, approval_id uuid NOT NULL, task_id uuid NOT NULL, run_id uuid NOT NULL,
  step_id uuid NOT NULL, task_revision integer NOT NULL, policy_revision integer NOT NULL,
  operation text NOT NULL, destination text NOT NULL, scope text NOT NULL, payload_ref uuid NOT NULL, payload_digest text NOT NULL,
  stable_provider_key text NOT NULL, fence bigint NOT NULL, state text NOT NULL DEFAULT 'prepared',
  provider_ref text, claimed_at timestamptz, observed_at timestamptz, next_reconcile_at timestamptz,
  safety_reserve_cents integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,effect_key),
  FOREIGN KEY(tenant_id,approval_id) REFERENCES kethora.approval(tenant_id,id),
  FOREIGN KEY(tenant_id,task_id) REFERENCES kethora.task(tenant_id,id),
  FOREIGN KEY(tenant_id,run_id) REFERENCES kethora.run(tenant_id,id),
  FOREIGN KEY(tenant_id,step_id) REFERENCES kethora.step(tenant_id,id)
);
CREATE INDEX invocation_uncertain ON kethora.invocation(next_reconcile_at) WHERE state IN('dispatching','uncertain');
CREATE TABLE kethora.attempt (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL DEFAULT gen_random_uuid(),
  invocation_id uuid NOT NULL, number integer NOT NULL, transport_result text NOT NULL,
  observation jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,invocation_id,number),
  FOREIGN KEY(tenant_id,invocation_id) REFERENCES kethora.invocation(tenant_id,id)
);

CREATE TABLE kethora.source_version (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  owner_task_id uuid, source_ref text NOT NULL, kind text NOT NULL, object_ref uuid NOT NULL,
  content_hash text NOT NULL, coverage text NOT NULL, status text NOT NULL DEFAULT 'active',
  search_text tsvector, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,owner_task_id) REFERENCES kethora.task(tenant_id,id)
);
CREATE INDEX source_owner_search ON kethora.source_version USING gin(search_text) WHERE status='active';
CREATE TABLE kethora.artifact (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL, owner_task_id uuid NOT NULL,
  current_version integer, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,owner_task_id) REFERENCES kethora.task(tenant_id,id)
);
CREATE TABLE kethora.artifact_version (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL, artifact_id uuid NOT NULL,
  version integer NOT NULL, object_ref uuid NOT NULL, object_hash text NOT NULL, manifest jsonb NOT NULL,
  task_revision integer NOT NULL, verified boolean NOT NULL DEFAULT false, stale boolean NOT NULL DEFAULT false,
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,artifact_id,version),
  FOREIGN KEY(tenant_id,artifact_id) REFERENCES kethora.artifact(tenant_id,id)
);
CREATE TABLE kethora.support_judgment (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  claim_id uuid NOT NULL, artifact_version_id uuid NOT NULL, source_version_id uuid NOT NULL,
  label text NOT NULL CHECK(label IN('supported','inference','disputed','missing')),
  locator jsonb NOT NULL, judgment jsonb NOT NULL, is_simulated boolean NOT NULL,
  stale boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,artifact_version_id) REFERENCES kethora.artifact_version(tenant_id,id),
  FOREIGN KEY(tenant_id,source_version_id) REFERENCES kethora.source_version(tenant_id,id)
);
CREATE INDEX judgment_source_lineage ON kethora.support_judgment(tenant_id,source_version_id,artifact_version_id);
CREATE TABLE kethora.memory (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  owner_scope text NOT NULL, semantic_type text NOT NULL, source_ref uuid, sensitivity text NOT NULL,
  content_ref uuid NOT NULL, revision integer NOT NULL, status text NOT NULL, valid_until timestamptz,
  search_text tsvector, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE INDEX memory_search ON kethora.memory USING gin(search_text) WHERE status='confirmed';
CREATE TABLE kethora.goal (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL, title text NOT NULL,
  description_ref uuid, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE kethora.monitor (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL, goal_id uuid,
  schedule_revision integer NOT NULL, source_ref uuid NOT NULL, zone text NOT NULL,
  next_due_at timestamptz, authority_expires_at timestamptz, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,goal_id) REFERENCES kethora.goal(tenant_id,id)
);
CREATE INDEX monitor_due ON kethora.monitor(next_due_at) WHERE status='active';
CREATE TABLE kethora.occurrence (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  monitor_id uuid NOT NULL, schedule_revision integer NOT NULL, intended_time timestamptz NOT NULL,
  coverage text NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,monitor_id,schedule_revision,intended_time),
  FOREIGN KEY(tenant_id,monitor_id) REFERENCES kethora.monitor(tenant_id,id)
);
CREATE TABLE kethora.feed_edition (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  instruction_revision integer NOT NULL, status text NOT NULL, omitted_count integer NOT NULL DEFAULT 0,
  manifest_ref uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE kethora.idea (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  proposal_ref uuid NOT NULL, evidence_ref uuid, status text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE kethora.notification_intent (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  intent_key text NOT NULL, channel text NOT NULL, recipient_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued', payload_ref uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,intent_key)
);
CREATE TABLE kethora.tombstone (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  target_kind text NOT NULL, target_id uuid NOT NULL, generation bigint NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at > created_at),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,target_kind,target_id,generation)
);
CREATE TABLE kethora.receipt (
  tenant_id uuid NOT NULL REFERENCES kethora.account(tenant_id), id uuid NOT NULL,
  task_id uuid NOT NULL, task_revision integer NOT NULL, result jsonb NOT NULL,
  signature bytea, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,task_id) REFERENCES kethora.task(tenant_id,id)
);

-- RLS applies to all tenant tables, including the account table. Workload roles have no BYPASSRLS.
DO $$ DECLARE tbl record; BEGIN
  FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname='kethora' AND tablename <> 'schema_migrations' LOOP
    EXECUTE format('ALTER TABLE kethora.%I ENABLE ROW LEVEL SECURITY',tbl.tablename);
    EXECUTE format('ALTER TABLE kethora.%I FORCE ROW LEVEL SECURITY',tbl.tablename);
    EXECUTE format('CREATE POLICY tenant_scope ON kethora.%I USING (tenant_id = nullif(current_setting(''kethora.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''kethora.tenant_id'',true),'''')::uuid)',tbl.tablename);
  END LOOP;
END $$;
COMMIT;
