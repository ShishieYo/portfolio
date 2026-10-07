# RAAF Online

Online encoding and automatic validation of the **Report of Accountability for Accountable Forms (RAAF)** for board certificates. It is modelled on the PRC Region 3 monthly workbook (Jan 2025 – Feb 2026): each report lists serial-numbered stock batches with Beginning / Receipt / Issue / Ending quantities and serial ranges, control totals, and four certifying signatories.

Encoders key in a report, the system checks it against configurable rules (totals, serial ranges, dates, duplicates, last month's balances…), and a reviewer approves it. Only an approved record whose approved version is the current version is ever labelled **Validated / Ready for reporting**. Everything else is stamped **Draft / Unvalidated** on screen, in print and in exports.

> This app lives in `raaf/` and is independent of the static portfolio site in the repository root, which is untouched.

## Contents

[Features](#features) · [Architecture](#architecture) · [Database](#database) · [Validation rules](#validation-rules) · [Roles](#roles-and-permissions) · [Install & run](#install-and-run-locally) · [Environment](#environment-variables) · [Tests](#testing) · [Deployment](#deployment) · [Demo data & credentials](#demo-data-and-credentials) · [Assumptions](#assumptions) · [Limitations](#known-limitations) · [Future work](#future-enhancements)

## Features

- **Encoding** in four sections (Report details · Accountable forms · Control totals · Certification). It has a searchable form-name picker backed by a catalog, month/date pickers, digits-only numeric inputs, and auto-fill of quantity from From/To serials. The lines grid works like a spreadsheet (Enter / ↑ ↓ move between lines). "Fill from lines" computes totals, and **carry forward** loads last month's ending balances as this month's beginning balances. You can save incomplete drafts at any time (Ctrl+S).
- **Live validation while typing**, using the same engine the server runs, with field highlighting and per-section issue counts. "Run validation" additionally performs the cross-record checks on the server.
- **Click an issue → jump to the field.** It switches section, scrolls, focuses and flashes the field. This works from the editor's issue panel and from the record's results page.
- **Validation status per record**: ✅ Valid · ⚠️ Warning · ❌ Error · ⏳ Not validated (or edited since) · 🔵 For review (workflow).
- **Validation history**: every run is stored with all its issues and the record version it ran against.
- **Dashboard**: totals, valid / warning / error / pending, for review, duplicates detected, success rate, most common issues, recently updated.
- **Records**: search (reference, entity, month, form name), filter by month range / validation result / status / user, sortable columns, server-side pagination.
- **Workflow**: Draft → (validate) → Submit for review → Reviewer approves **or** returns for correction → Approved. Errors block submission and approval. Approval **re-validates against current data** and requires a written note when warnings remain. Nobody can approve a record they encoded.
- **Reports**: a printable view (browser *Print → Save as PDF*, landscape), **CSV** (UTF-8 BOM for Excel, formula-injection safe) and **Excel (.xlsx)** in the official layout. Each is stamped with its validation state.
- **Data integrity**:
  - Every record has a UUID and a sequential reference (`RAAF-000123`), plus created/modified timestamps and users.
  - Concurrency is optimistic: a stale save is rejected with a 409, never silently overwritten.
  - Idempotency keys stop a double-submit from creating a duplicate.
  - Nothing is deleted. Records are *voided* with a reason.
  - The audit log is append-only, enforced by database triggers.
- **Administration**: manage users, edit validation rules (severity, enabled, wording, parameters), the form catalog and default signatories, and browse the audit log.

## Architecture

```text
raaf/
├─ src/shared/            Pure TypeScript used by BOTH browser and server
│  ├─ validation/           engine.ts · evaluators.ts (rule types) · defaultRules.ts · helpers.ts
│  ├─ types.ts, api.ts      domain + API types        permissions.ts  role → permission map
│  └─ demoData.ts, formCatalog.ts, fieldLabels.ts
├─ src/server/            Express 5 + SQLite (node:sqlite, no native build)
│  ├─ app.ts                routes, security headers, CSRF header check, error handling
│  ├─ records.ts            create/update/list/read, field-level audit diff, access control
│  ├─ validation.ts         builds cross-record context, runs the engine, stores run + issues
│  ├─ workflow.ts           submit / approve / return / void
│  └─ rules, settings, exports, dashboard, auth, audit, db, seed
├─ src/client/            React 19 + React Router + Vite (plain CSS, no UI framework)
└─ tests/                 Vitest: engine unit tests + HTTP integration tests
```

**One validation engine, rules as data.** `validateReport(report, rules, env)` is a pure function. A rule is a record, not code:

```text
Validation Rule
├── id            RAAF-TOTAL-004
├── scope         header | line | record
├── type          sum_equals           (an evaluator in evaluators.ts)
├── fields        ["totals.endingQty"] (where to jump to)
├── condition     { "total": "totals.endingQty", "sum": "ending.qty" }
├── severity      ERROR | WARNING
├── message       "{label} is reported as {actual} but the lines add up to {expected}."
├── resolution    "Correct the control total or the line quantities."
└── enabled
```

Rules are seeded from `defaultRules.ts` into the `validation_rules` table on first start. Administrators can edit them (severity, wording, parameters, on/off) without a deploy; edits are audited and apply to the next run. Adding a rule that uses an existing type (another `required` field, a different `number` limit) is just a new entry or row. A genuinely new kind of check is one small function registered in `evaluators.ts`.

The server is authoritative. The browser uses the same engine only for instant feedback. Cross-record checks (duplicates, last month's balances, entity-name consistency) need server data, so they run on the server.

**AI-assisted review is not implemented**, but the design leaves room for it. Issues carry a `source` (`rule` | `ai`), validation runs are stored separately from the record, and nothing in the workflow depends on an AI result. A future AI reviewer would write its own run with `source = 'ai'`, displayed apart from the rule-based results, and could never turn a failing record into a valid one.

## Database

SQLite (a single file) via Node's built-in `node:sqlite`. There is no server to run, a backup is one file, and it scales comfortably to this workload (one office, monthly reports). Foreign keys are on, WAL mode is enabled, and the list/filter columns are indexed.

```text
users ──< raaf_records ──< raaf_details            (one row per form line)
  │            │
  │            └──< validation_runs ──< validation_issues
  └──< sessions            validation_rules   form_catalog   settings
audit_logs  (append-only; refers to users/records by id)
```

| Table | Purpose |
|---|---|
| `users` | accounts: scrypt password hash, role, active flag |
| `sessions` | server-side sessions (SHA-256 of the cookie token, expiry) |
| `raaf_records` | report header, control totals, workflow + validation status, `version`, creator/modifier and timestamps, review/void info |
| `raaf_details` | one row per form line: beginning / receipt / issue / ending quantity + serial from/to |
| `validation_runs` | every validation run: record version, status, counts, who/when |
| `validation_issues` | every issue of every run: rule, severity, field path, line, message, resolution, `source` |
| `validation_rules` | the rule definitions described above |
| `form_catalog` | accountable form names used for the picker and the catalog check |
| `settings` | default entity / signatories for new reports |
| `audit_logs` | date/time, user, action, record, field, old value, new value. `UPDATE`/`DELETE` are blocked by triggers |

**Backup:** `npm run backup [-- <dir>]` writes a consistent snapshot (`VACUUM INTO`) while the app is running. To restore, stop the app and copy the snapshot over `DATABASE_PATH`.

## Validation rules

41 rules ship by default. Administrators can change any of them under **Validation rules**. Severity **Error** blocks submission and approval. **Warning** is allowed but needs a reviewer's acknowledgement.

| Rule | What it checks | Type | Severity |
|---|---|---|---|
| `RAAF-REQ-001` | Report details complete | `required` | Error |
| `RAAF-REQ-002` | Preparer and checker named | `required` | Error |
| `RAAF-REQ-003` | Attesting and noting officers named | `required` | Warning |
| `RAAF-REQ-004` | Control totals entered | `required` | Error |
| `RAAF-REQ-005` | At least one form line | `min_lines` | Error |
| `RAAF-LINE-001` | Form name required | `required` | Error |
| `RAAF-LINE-002` | Opening stock or receipt entered | `any_present` | Error |
| `RAAF-LINE-003` | Empty line | `blank_line` | Warning |
| `RAAF-DATE-001` | Reporting month is a valid month | `date_format` | Error |
| `RAAF-DATE-002` | Certification date is a valid date | `date_format` | Error |
| `RAAF-DATE-003` | Reporting month not in the future | `date_bounds` | Error |
| `RAAF-DATE-004` | Certification date not in the future | `date_bounds` | Error |
| `RAAF-DATE-005` | Certified after the period starts | `chronological` | Error |
| `RAAF-DATE-006` | Certified after the period ends | `chronological` | Warning |
| `RAAF-NAME-001` | Entity name spelling | `text_format` | Warning |
| `RAAF-NAME-002` | Entity name matches earlier reports | `known_value` | Warning |
| `RAAF-LINE-004` | Form name spelling | `text_format` | Warning |
| `RAAF-LINE-005` | Form is in the catalog | `catalog_lookup` | Warning |
| `RAAF-NUM-001` | Quantities and serials are whole numbers | `number` | Error |
| `RAAF-NUM-002` | Unusually large quantity | `number` | Warning |
| `RAAF-NUM-003` | Serial number out of range | `number` | Warning |
| `RAAF-NUM-004` | Control totals are whole numbers | `number` | Error |
| `RAAF-NUM-005` | Face value is not negative | `number` | Error |
| `RAAF-SER-001` | Quantity and serial range complete | `serial_group` | Error |
| `RAAF-SER-002` | Serial range in order | `serial_group` | Error |
| `RAAF-SER-003` | Quantity matches serial range | `serial_group` | Error |
| `RAAF-SER-004` | Issued serials come from the opening stock | `serial_continuity` | Error |
| `RAAF-SER-005` | Ending serials are what remains | `serial_continuity` | Error |
| `RAAF-BAL-001` | Beginning + receipt - issue = ending | `equation` | Error |
| `RAAF-TOTAL-001` | Beginning total matches lines | `sum_equals` | Error |
| `RAAF-TOTAL-002` | Receipt total matches lines | `sum_equals` | Error |
| `RAAF-TOTAL-003` | Issue total matches lines | `sum_equals` | Error |
| `RAAF-TOTAL-004` | Ending total matches lines | `sum_equals` | Error |
| `RAAF-TOTAL-005` | Line count matches lines | `sum_equals` | Error |
| `RAAF-TOTAL-006` | Control totals reconcile with each other | `equation` | Error |
| `RAAF-DUP-001` | No duplicate report for the month | `duplicate_report` | Error |
| `RAAF-DUP-002` | No duplicate lines | `duplicate_lines` | Error |
| `RAAF-DUP-003` | Serial ranges do not overlap | `serial_overlap` | Error |
| `RAAF-CONS-001` | Beginning balance equals previous ending | `previous_carryover` | Error |
| `RAAF-CONS-003` | Previous ending balances carried forward | `previous_uncarried` | Error |
| `RAAF-CONS-002` | Previous month report on file | `previous_missing` | Warning |

Notes on specific behaviour:

- The workbook records a single issued serial as quantity 1 with *To* = 0. The engine treats that as From = To.
- Totals and per-line checks ignore empty lines (an empty line is itself a warning).
- Previous-month checks compare against the most recent non-void report for the same entity (case/spacing-insensitive) for the preceding month, preferring an approved one. If earlier reports exist but none for the previous month, that is a warning rather than an error.

## Roles and permissions

| | Administrator | Encoder | Reviewer |
|---|:-:|:-:|:-:|
| Create records / edit drafts | ✔ (any) | ✔ (own) | – |
| Run validation, view results | ✔ | ✔ (own records) | ✔ (all) |
| Submit for review | ✔ | ✔ | – |
| Approve / return for correction | ✔ (not own) | – | ✔ |
| Void a record | ✔ | own, not approved | – |
| View all records | ✔ | – | ✔ |
| Manage users · rules · settings · audit log | ✔ | – | – |

Permissions are a map in `src/shared/permissions.ts`. To add a role, add an entry there, to the `Role` type, and to the `users.role` CHECK constraint.

## Install and run locally

Requires **Node.js 22.13+** (it uses the built-in `node:sqlite`).

```bash
cd raaf
npm install
npm run dev          # API on :3000 + Vite on http://localhost:5173 (open this one)
```

On first start with an empty database the app creates the demo users and sample records (see below). The database file is `./data/raaf.db`. Delete it to start over.

```bash
npm run build        # type-check, build the client, bundle the server into dist/
npm start            # serves API + built client on http://localhost:3000
npm test             # unit + integration tests
npm run typecheck
npm run backup
```

`npm start` serves the built client only when `NODE_ENV=production`, and production session cookies are `Secure`. Browsers accept `Secure` cookies on `http://localhost`, so this works for a local check of the production build:

```bash
NODE_ENV=production SEED_DEMO_DATA=true npm start
```

## Environment variables

Copy `.env.example` to `.env` (git-ignored) or set these in your host. Nothing secret is committed.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | – | `production` serves the built client and sets `Secure` cookies |
| `DATABASE_PATH` | `./data/raaf.db` | SQLite file; point it at a persistent disk in production |
| `SESSION_TTL_HOURS` | `12` | sign-in lifetime |
| `APP_TIMEZONE` | `Asia/Manila` | what "today" means for the not-in-the-future checks |
| `SEED_DEMO_DATA` | `true` in dev, `false` in production | create demo users + sample records on an **empty** database |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / – | first administrator when `SEED_DEMO_DATA` is not `true`. **Required** (12+ characters): the app refuses to start without it |

## Testing

`npm test` runs 69 tests in about three seconds:

- **`tests/engine.test.ts`** covers the validation engine: required fields, date validity/range/chronology, numeric validity, serial ranges, total/subtotal reconciliation, duplicate detection (report, line, overlap), cross-field and cross-record consistency, severity, several errors on one record, rules added/disabled/re-graded as data, and revalidation after correction. It also checks that each demo record produces its documented result.
- **`tests/api.test.ts`** is HTTP integration against an in-memory database. It covers authentication and lockout, the CSRF header, the full *encode → validate → fix → revalidate → submit → approve → export* workflow, return/void, warning acknowledgement, re-validation at approval, idempotent create, optimistic-concurrency conflicts, audit entries with old/new values, append-only audit, role restrictions, admin rule changes taking effect, and search/filter/sort/paging.
- **`tests/exports.test.ts`** covers export labelling and CSV safety.

CI (`.github/workflows/raaf-ci.yml`) runs the tests and the production build on every push or PR that touches `raaf/`.

## Deployment

The app is one Node process plus one SQLite file. It is not tied to the GitHub Pages site in the repository root, because static hosting cannot run it.

**Any host with Docker** (Render, Fly.io, Railway, a VPS…):

```bash
docker build -t raaf-online raaf
docker run -d --name raaf -p 3000:3000 -v raaf-data:/data \
  -e ADMIN_PASSWORD='choose-a-long-password' raaf-online
```

The image runs with `NODE_ENV=production`, stores the database in the `/data` volume, creates the administrator from `ADMIN_PASSWORD` (no demo accounts), and has a health check on `/api/health`. **Terminate TLS in front of it** (managed hosts do this for you), because session cookies are `Secure`.

**Render:** `raaf/render.yaml` is a Blueprint (Docker, 1 GB disk at `/data`, `ADMIN_PASSWORD` prompted on first deploy). SQLite needs a persistent disk, which Render offers on paid web services. Without a disk the data is lost on every redeploy.

**Without Docker:** run `npm ci && npm run build`, then start it under a process manager behind a reverse proxy:

```bash
NODE_ENV=production ADMIN_PASSWORD='…' DATABASE_PATH=/var/lib/raaf/raaf.db npm start
```

Only production dependencies are needed at runtime (`npm ci --omit=dev` after copying `dist/`).

**Checklist before real data:** set `ADMIN_PASSWORD`, leave `SEED_DEMO_DATA=false`, put the volume on backed-up storage (schedule `npm run backup`), and serve over HTTPS only.

## Demo data and credentials

With `SEED_DEMO_DATA=true` (the default in development), an empty database gets these accounts, all with password **`Demo@RAAF2025`**. They are public, so never enable demo data on a deployment that holds real information.

| Username | Role |
|---|---|
| `admin` | Administrator |
| `encoder1`, `encoder2` | Encoder |
| `reviewer1` | Reviewer |

It also gets seven sample reports (invented names and serial numbers) that exercise the validation engine. They are validated through the real services, so each has a genuine validation history and audit trail:

| Ref | Entity · month | Demonstrates | Result |
|---|---|---|---|
| RAAF-000001 | Pampanga · Jan 2025 | **Valid**: completely correct | ✅ Valid, approved |
| RAAF-000002 | Pampanga · Feb 2025 | Valid, balances carried forward from January | ✅ Valid, 🔵 for review |
| RAAF-000003 | Pampanga · Mar 2025 | **Consistency errors**: beginning balance ≠ February's ending, certified before the month began, wrong ending serial | ❌ Error |
| RAAF-000004 | Pampanga · Apr 2025 | **Warning**: misspelt form (`OPTOMETRSIT`), unusually large quantity, certified before month end, officers not named | ⚠️ Warning |
| RAAF-000005 | Tarlac · Mar 2025 | **Mathematical errors**: quantity ≠ serial range, ending ≠ beginning + receipt − issue, totals do not add up | ❌ Error |
| RAAF-000006 | Bulacan · Feb 2025 | **Missing data**: no certification date, missing signatory fields, nameless line, incomplete serial range, no control totals | ❌ Error |
| RAAF-000007 | Pampanga · Jan 2025 | **Duplicate**: same entity and month as RAAF-000001, repeated line, overlapping serials | ❌ Error |

Try it: sign in as `encoder2`, open RAAF-000005, click an issue, fix the figures, *Run validation*, then *Submit for review*. Sign in as `reviewer1` to approve and print.

## Assumptions

- A **record is one monthly report** for one entity, and its **details are the form lines**. The Records page, dashboard and duplicate check work at that level.
- The form layout follows the workbook. Face value and form number are optional (board certificates have none).
- The form catalog uses the workbook's names with two corrections: `AGIRCULTURAL AND BIOSYSTEM` → `AGRICULTURAL AND BIOSYSTEMS ENGINEER`, and `CHEMICAL TECH` → `CHEMICAL TECHNICIAN`. Please confirm these against the official names. The catalog is editable.
- Issued serials come out of the line's own beginning (or received) range, from either end, and the ending range is what remains. Issues taken from the middle of a batch are not predicted.
- Beginning balances must equal the previous month's ending balances line-for-line (same form, quantity and serial range).
- Control totals are typed by the encoder and cross-checked. They work like a check digit and are not computed silently.
- Nobody may approve a record they encoded (four-eyes), including administrators.
- Encoders see only their own records. Duplicate and previous-month checks still look across all records.
- "Today" is evaluated in `Asia/Manila`.
- The first RAAF for an entity has no previous month to compare with and is not warned about it.

## Known limitations

- **Import** of the existing Excel workbook is not built. Reports are encoded through the form.
- Sign-in is username + password only (no SSO, MFA or password-reset email). Administrators reset passwords. The login limiter lives in process memory.
- Single-process SQLite is right for one office, not for horizontal scaling across instances.
- `node:sqlite` is flagged experimental by Node 22 (a warning is printed at start). It is stable in practice and has a small API surface, and swapping the driver would touch only `db.ts`.
- Live validation covers the rule types that need only the report itself. Duplicate and previous-month checks run when you click *Run validation*.
- Printing relies on the browser's *Save as PDF* (no server-side PDF).
- `exceljs` pulls in a transitive `uuid` that `npm audit` flags as moderate. The advisory concerns `v3/v5/v6` called with a caller-supplied buffer, which `exceljs` does not do.
- No browser (E2E) tests are committed. The UI was exercised manually with a headless browser during development.

## Future enhancements

- Import the monthly workbooks (`.xlsx`) into records to backfill history.
- Optional **AI-assisted review** (anomaly detection, plain-language explanations) as a separate, clearly labelled run (`source = 'ai'`), with the deterministic rules staying the gate.
- Email/Teams notifications on submit/return; SSO/MFA.
- A rule-authoring UI for new rule instances (today you edit existing ones and add new ones via the seed or SQL).
- Year-to-date and trend reports; month-end lock.
- Playwright E2E tests in CI.
