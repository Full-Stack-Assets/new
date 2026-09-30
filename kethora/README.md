# Kethora

A runnable local personal-agent workspace with a responsive TypeScript web client,
a native SwiftUI iOS client, persistent tasks, saved drafts, and an optional NVIDIA
API integration. Built from the supplied Kethora blueprint and Muse interface
references under original Kethora branding.

**This is a local development edition, not the completed G0–G4 production product.**
The default worker creates explicitly labeled deterministic previews. NVIDIA tasks
produce unverified AI drafts after explicit consent. No live calendar write,
autonomous browser, purchase, or unisolated agent execution is connected.

## Start the web app

Requirements: Node **24.19.0 or later on the 24 LTS line**, npm 11.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:8787**. Your workspace starts empty, with editable identity
and memory files. Send a task, attach UTF-8 text/Markdown/CSV, create a goal, or
explore Ideas. Task work continues on the server when the browser closes. SQLite
WAL transactions save the workspace in `data/local.sqlite` and recover queued
work after server restart. This local queue is separate from the production
PostgreSQL/Temporal architecture.

The API binds only to localhost. The local cookie represents access to a single
workspace on your development machine; **it is not a production identity or a
passkey**. Do not expose this edition through a public proxy or use real sensitive
data in the unencrypted development store. There is no public deployment in this
package.

## Optional NVIDIA API

Copy `.env.example` to `.env`, enter `NVIDIA_API_KEY` and a specific
`NVIDIA_MODEL` identifier supported by your NVIDIA account, and restart the
server. Secrets stay on the server and are never returned to clients.

In Settings → Model & usage, review the named route and consent. Select NVIDIA
in the message composer for a task. The route receives the request, attached
source text, and saved memory. Outages wait visibly on that same route; changing
its model does not silently transfer an existing task. Invalid structured output
gets one counted repair. Every call counts toward the twelve-call task limit.
Oversized context is refused with a named waiting reason rather than silently
truncated. Provider dollar costs are not measured in this edition.

Production use still requires processor terms, no-training commitments, named
model and judge IDs, calibrated evaluations, and account-specific authorization.
No live NVIDIA call was run during construction because no API credentials were
provided. Adapter tests use deterministic response fixtures.

## Implemented local flows

- Chat and searchable side conversations; server-acknowledged task admission.
- Persistent task activity, pause/resume/cancel, optimistic revision checks,
  correction, and immutable artifact history with stale historical versions.
- Saved Markdown and tagged PDF drafts with download, hash, and provenance.
  PDF opening/text extraction is tested; PDF/UA and screen-reader conformance
  are **not** claimed. Factual claims never receive a verified label here.
- Library source uploads, editable System Files, and separate file descriptions.
  Source deletion removes derived artifact records and cancels dependent work.
- Goals with user-confirmed milestones; Ideas based on saved goals or explicit
  starter suggestions; accepting a suggestion only fills a draft until Send.
- Persisted Feed updates linked to saved tasks, reactions, linked discussions,
  and versioned instructions for future updates. Autonomous news/feed scheduling
  is not enabled.
- Profile, appearance, provider consent, in-product notification preference,
  data export, reset and honest deletion receipts. Email/APNs are unavailable.

## Native iOS

Open `apps/ios/Kethora.xcodeproj` in **Xcode 16+** on macOS. Select the Kethora
scheme and an iOS 18+ simulator. Debug builds default to
`http://localhost:8787/v1/` on the same Mac running the API. Release builds fail
closed at `https://api.kethora.invalid/v1/` until an owned HTTPS API is configured.
HTTP is permitted by the client only for loopback in Debug builds.

The included SwiftUI source uses the same saved resource IDs and API for the five
canonical surfaces: Chat/Tasks, Feed (with Ideas), Goals, Library and Settings.
It includes file import, task controls, artifact sharing, memory editing, and
persistent local message drafts. Swift 6.0.3 syntax parsing, three portable model tests, and project/plist checks passed. See [native setup](apps/ios/README.md). iOS SDK builds and simulator tests were **not run**
on this Linux machine. Device distribution needs your bundle ID, Apple signing
team, icons, production identity, and hardening checks.

Alternatively regenerate the project with the pinned XcodeGen 2.46.0 specification
in `apps/ios/project.yml`. See `docs/runbooks/ios.md`.

## Verification

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

For installed system Chromium, use
`KETHORA_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`.
The browser suite uses an isolated port and temporary synthetic SQLite store.
It covers desktop/mobile flows, untrusted HTML rendering, and automated WCAG
checks. Automated checks do not replace human assistive-technology review.

Infrastructure fixtures are separately exercised:

```sh
docker compose -p kethora-verification -f infra/compose.local.yaml up -d
KETHORA_MIGRATION_DATABASE_URL=postgresql://kethora_dev_migration:synthetic-local-only@127.0.0.1:5432/kethora_local npm run migrate
KETHORA_MIGRATION_DATABASE_URL=postgresql://kethora_dev_migration:synthetic-local-only@127.0.0.1:5432/kethora_local npm run test:infra
```

On proxied development machines, add `NO_PROXY=localhost,127.0.0.1,0.0.0.0` to the
runner. The fixture suite verifies actual PostgreSQL RLS and transactional
admission, a version-pinned Temporal coordinator across worker restart, an
S3-compatible authenticated roundtrip, and the synthetic calendar's health.
These fixtures are not connected to the local application's SQLite worker and
are not authorized live-provider tests. Stop them with the same Compose command
followed by `down`; omit `-v` to preserve data.

## Construction evidence and remaining production work

`docs/receipts/local-test-receipt.json` records actual environment, source hashes,
checks and limits. `docs/receipts/gate-status.json` keeps G0–G4 unclaimed and G5
staged only. `docs/coverage/local-parity.md` separates working local behavior,
iOS source, fixture contracts, and unavailable production behavior.

The remaining production work includes passkey/recovery identity; wiring the
complete PostgreSQL/outbox/Temporal execution and private encrypted object store;
scoped agent VMs and inner microVMs; secure web/PDF ingestion; source-to-claim
judgment calibration; provider-native OAuth and trusted approvals; live calendar
capability tests; monitors/background budgets; deletion/restore drills; mobile
hardening; email; incident ownership; and legal/alpha release evidence. No gate,
Muse behavior parity, security certification, or invited-alpha outcome is claimed.
