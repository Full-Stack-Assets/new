# KETHORA — Turnkey Codegen Prompt

Hand this prompt plus the two attached source documents to a builder agent. It is written to be executed autonomously, gates G0 through G4, with G5 staged but not claimed.

## 1. Mission

Build Kethora, a persistent personal AI agent for iOS and the web, from the attached construction specification. Work autonomously through gates G0–G4 and stage G5. The specification is authoritative; this prompt is the execution wrapper. Where this prompt and the specification conflict, the specification wins except for the explicit resolutions in §4.

## 2. Source documents (attached — read both before writing any code)

1. `Kethora_Personal_Agent_Blueprint_v1.1.txt` — **authoritative build specification** (§1–§24, decisions D01–D08, coverage C01–C26, tests A/M/P/S/U/E, gates G0–G5).
2. `kethora-blueprint-build-review.pdf` — verification checklist and remediation history, including the v1.1 reconciliation addendum and the build-sufficiency verification addendum. Treat its gap dispositions as acceptance-test sources, not as new requirements.

## 3. Stack pins (from specification §1)

- Clients: native Swift iOS app targeting iOS 18+, responsive TypeScript web client. One HTTPS API, one server task model.
- Backend: TypeScript on the Node.js 24 LTS line. Lock exact dependency versions and the runtime image digest in the repository.
- Durable coordination: Temporal with Worker Deployment Versioning. Pin exact server, TypeScript SDK, and image versions at G0 (D03).
- Database: PostgreSQL 18, forward-only reviewed migrations. Business facts, intent, ownership, policy, approvals, and committed results live in PostgreSQL; Temporal history stores references, never private document bytes.
- Files: private versioned object storage, encryption at rest, per-owner authorization, short-lived download URLs. API-compatible container for local development.
- Identity: passkey-first registration and sign-in, recovery codes, device/session management, server-side session revocation, authenticated step-up for high-risk approvals and account reset.
- Deployable units: api, command, workflow, model, broker, gateway, sandbox, artifact, evidence, scheduler, notification, reconciler, operator. They may share a repository but never privileged runtime identities.

## 4. Explicit resolutions (decided here — do not re-litigate, do not leave open)

- **R1 — Five navigation surfaces.** The specification names but never enumerates them (G3 exit evidence). They are: **Tasks, Library, Feed, Goals, Settings.** "All five navigation surfaces show real persisted data" means these five.
- **R2 — Agent compute (D-09 adopted as canonical).** Every acting agent — the primary assistant and every child worker — runs in its own Linux VM: dedicated filesystem and process space, its own network identity, no cross-agent VM routes, zero ambient credentials, broker-issued scoped credentials only, per-agent audit trail and cost attribution, full provision/snapshot/suspend/terminate lifecycle. The specification's disposable microVMs for untrusted code (§4/§11) remain the *inner* sandbox; D-09 is the *outer* per-agent machine boundary. Revert to microVM-only scope only on explicit principal instruction.
- **R3 — iOS UI framework.** SwiftUI unless a named requirement forces otherwise. Record the choice in the G0 decision log.
- **R4 — Email delivery provider.** Select at G4. Until then, in-product inbox only. Never let this block earlier gates.

## 5. Non-negotiable engineering laws

1. **Evidence-first completion.** Every claimed effect is confirmed, failed, or explicitly uncertain — never assumed. (Spec §6–§7; tests A09–A11, A16, A19.)
2. **No silent degradation.** Processor outage → `waiting(provider)`; exactly one counted schema repair, then a visible wait or failure; no model substitution without fresh consent. (D02; A17–A18.)
3. **Approval integrity.** Consequential actions require authenticated approval of the exact immutable payload in the trusted UI. Changed terms, expired or replayed approvals, or revocation committed before claim → no dispatch. (A06–A08; U15.)
4. **Credential hygiene.** Implement the §22 credential table exactly. Sandbox/browser workers receive no credentials — copied scoped inputs and egress permits only. No provider token in workflow history. No ambient authority anywhere.
5. **Deterministic builds.** Pinned toolchains, images, and migrations. The clean-checkout contract must pass from zero on a fresh machine before any gate is claimed: install toolchains, start local database/workflow engine/object store/test calendar fixture from checked-in container definitions, apply migrations, load synthetic fixtures, run unit/contract/fault/web-e2e tests, build the iOS client with documented signing placeholders, run the iOS simulator target, export the test receipt.
6. **Cost honesty.** The 12-turn limit counts *every* inference call, including child, schema-repair, and judgment calls. Enforce per-edition and daily background budgets; mark partial coverage as `partial_budget` with omitted content named. (§8, §13; E04.)

## 6. Build sequence (spec §19 four-week plan; gates §20)

- **G0 Contracts (week 1).** Repository layout per spec §19: `apps/web, apps/ios, services/api, services/command, services/workflow, services/model, services/broker, services/gateway, services/artifact, services/evidence, services/scheduler, services/notification, services/reconciler, workers/sandbox, packages/contracts, db/migrations, tests/unit, tests/contract, tests/fault, tests/e2e, tests/evals, docs/coverage, docs/decisions, docs/runbooks, infra`. Freeze task/action/evidence schemas, operation registry, threat model, UX routes, coverage ledger, fixture plan. Typed CalendarAdapter seam, claim-support judgment schema, executable source/citation fixture pack. Sign decision log D01–D04 and D07–D08 with actual route/version values. **Exit:** migrations plus schema/property tests and clean setup pass; capability spike and model-eval fixture skeleton recorded; G0 receipt listing fixed decisions and remaining gate blockers. No user data may reach an unnamed processor.
- **G1 Durable personal work (week 2).** Auth, command/outbox, versioned workflow, source read, model gateway, artifact store, claim-support judgments, correction, activity, both clients. **Exit:** critical journey J1 through artifact v2 on both clients after app closure and worker restart; tagged PDF opens with claim lineage; A01–A05, A12–A13, A17–A22, S05, U01–U03, U05–U06, E01–E03 pass; support-judgment calibration meets §12 thresholds (≥50 golden tasks, zero fabricated locators, zero false verified labels, ≥90% human agreement, ≥0.80 macro-F1). No live calendar write enabled.
- **G2 Consequential action (week 3).** Broker, trusted approval, credential vault, per-provider tested connections, invocation ledger, reconciler, recovery ceremony, incident ownership. **Exit:** full J1 calendar path and uncertainty path on each enabled provider/server class in fixtures AND authorized live accounts; A06–A11, A14/A14x, A16, A19 write variant, S01–S04, S07/S07b/S08/S09, U04, U10, U15–U16 pass; untested classes stay read-only.
- **G3 Persistent assistant (week 4).** Structured memory/files, goals, monitors, Feed, Ideas, scheduler, background budgets, feedback loop. **Exit:** J2/J3, M01–M02, P01–P08, P11, C21–C22, E04 pass; all five navigation surfaces (§4 R1) show real persisted data.
- **G4 Production envelope.** Export/reset with deletion receipts, deduplicated notifications, limits, backups, accessibility (PDF/UA + human screen-reader check), observability, cost measurements, mobile hardening. **Exit:** restore/deletion drill, M03–M06, P09–P10, U11–U14 pass.
- **G5 Controlled release — STAGE, DO NOT CLAIM.** Full regression, isolated previews if enabled, real connector manifest, legal review, load profile, versioned ledger/build receipt. G5 requires the outcome measure: 14 consecutive invited-alpha days, ≥50 eligible admitted read-to-brief tasks from ≥25 distinct accounts, ≥95% verified-success by the user-agreed deadline, zero hard blockers. This needs real invited users — prepare everything, claim nothing.

## 7. Blocked-on-human protocol

Several gate inputs require a human and must never be invented: the production processor/model IDs, DPA, no-training-use terms, and consent UX (G0/D02); authorizing live OAuth test accounts per provider/server class (G2/D01); named incident primary/backup and runbook (G2/D05); legal review including Article 50 applicability, Terms/Privacy, and launch geography (G5/D06); the 25-account invited cohort (G5). When blocked:

1. Build the seam and contract, prove it against deterministic fixtures and synthetic accounts.
2. Record the item as a named gate blocker in the gate receipt, stating the exact evidence that closes it.
3. Continue all unblocked work. Never stall the build, never invent credentials or legal documents, never mark a gate passed while blockers are open.

## 8. Definition of done (global)

- Every C01–C26 row has its listed tests passing on the listed platforms.
- Every gate's exit evidence exists as files, migrations, and test IDs — not prose claims.
- Every `waiting()` state carries reason, responsible party, resume condition, and timestamps; workflow/projection disagreements reconcile by event position, never by picking the better-looking state.
- Tombstones outlive the oldest restorable backup; restore replays tombstones before activation.
- No user data reaches an unnamed processor; no external write ships until its account class is tested and its owner and runbook are named.

## 9. Scope guards

One-off calendar events only — no recurrence or alarms in v1. No agent-initiated purchases or financial commitments. No recurrence engine, no rich media generation. Editable user content never compiles into policy schema or the operation registry. A loosening policy version never grants an existing task additional access.
