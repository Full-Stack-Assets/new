# Construction parity — 2026-09-30

The reference recording establishes interface observations, not Muse's private
backend. This table compares the supplied reference flows to this build. It does
not promote the authoritative coverage ledger's production gates.

| Flow | Web local edition | Native iOS | Evidence / production difference |
|---|---|---|---|
| Five canonical surfaces + Ideas | Working, persisted resource data | SwiftUI source | WEB-01–07; native compile not run |
| Main / side chats / search | Working | Source | Conversation search; shared workspace, no side-chat privacy isolation claim |
| Task admission / activity / control | Working SQLite transactions | Source | LOCAL-API-01–06; production passkeys and full PG/Temporal execution remain |
| Close app / restart worker | Tested local server restart | Source | LOCAL-API-06; browser closure in WEB-01 |
| NVIDIA processing | Optional named, consented route | Source | NVIDIA-LOCAL-01–08 fixture responses; no live API test |
| Saved Markdown / PDF | Actual downloads and hashes | Sharing source | LOCAL-PDF-01, pdfinfo/pdftotext receipt; PDF/UA and claim-quality calibration pending |
| Artifact correction / stale v1 / v2 | Working immutable versions | Source | LOCAL-API-04, WEB-01 |
| Library → System Files → viewer/editor | Working, versioned file contents | Source | WEB-03; metadata kept outside file content |
| Feed cards / reactions / linked discussion | Saved task updates | Source | LOCAL-API-10, WEB-05; no autonomous editorial/news generation |
| Feed instructions | Save/cancel + future revision metadata | Source | WEB-05; scheduler not connected |
| Ideas | Saved-goal proposals + starter suggestions | Source | No permission grant or auto-execution on view; explore drafts explicit intent |
| Goals / milestones | Working, user-confirmed progress | Source | LOCAL-API-07, WEB-02; no fabricated verified progress |
| Sources | Text/Markdown/CSV uploads | Import source | WEB-04; HTTPS/PDF ingestion pipeline unavailable |
| Source deletion | Removes local source/derived artifacts; cancels dependents | API source | LOCAL-API-08; no disk erasure/backup purge claim |
| Profile / appearance / model consent | Working | Source | Provider disclosure, defaults no model transmission |
| Connections / approvals | Explicitly unavailable | Explicitly unavailable | Live OAuth/accounts, trusted approval and broker identities not configured |
| Monitors / scheduling | Not connected | Not connected | Isolated budget/occurrence contracts only |
| In-product inbox | Working and deduplicated by committed publish | Refresh/source | LOCAL-API-03/10; email and APNs unavailable |
| Export / reset | Working JSON + deletion receipt | Source | LOCAL-API-11; format not importable, limitations named |
| Accessibility | Automated desktop/mobile checks + keyboard flows | Source only | WEB-06/07; human VoiceOver/screen-reader/PDF validation pending |
| PostgreSQL ownership | Nonowner runtime tested | Shared production seam | INFRA-PG-01–04; local app is one workspace, not a production account system |
| Temporal versioning | Pinned coordinator fixture tested | Shared production seam | INFRA-TEMPORAL-01/02; full execution and production server remain unverified |
| Object store | Authenticated S3 fixture roundtrip | Shared production seam | INFRA-S3-01; production encryption/versioning/ownership not proved |
| Per-agent Linux VMs | Fail-closed interface only | Shared service | D09 provider/base image/attestation/isolation suite pending |
| Media / voice / wallet / payments | Not enabled | Not enabled | Rich media and purchases are out of v1 scope; no decorative paid plan or invented balance |

Source references: supplied Muse iOS Spec 0.2, Product Definition, screen audit,
Findings, turnkey wrapper, and authoritative blueprint in `docs/spec`.
