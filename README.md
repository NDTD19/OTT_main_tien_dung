# OTTv2 — OTT Arena

**A Battlecode-style platform for programming-bot matches and tournament development.** Students submit programs that play a turn-based Rock–Paper–Scissors strategy game; the server validates moves, records results, and provides replays and practice ratings.

> **Development status — Phase 6 foundation (October 2026).** This branch introduces PostgreSQL/Prisma alongside the existing JSON backend. The PostgreSQL API and local Docker-based practice runner are **development implementations**, not a production-ready tournament service. The official tournament workflow, full role-based authorization, durable distributed workers, offline/LAN synchronization, and capacity testing are future work.

**Working branch:** [`refactor/phase-1-foundation`](https://github.com/trankhoaasafaaa/OTTv2/tree/refactor/phase-1-foundation)  
**Repository:** https://github.com/trankhoaasafaaa/OTTv2

## 1. What is implemented?

| Area | Current status |
| --- | --- |
| Browser UI: submissions, match arena, replay viewer, leaderboard | Available as a development UI; some tournament screens contain illustrative content |
| Game engine | Working 8×8 OTT RPS prototype in `server/engine.js` |
| Bot execution | Local Docker sandbox for single-file Python, Java, and C submissions |
| PostgreSQL + Prisma | Schema, versioned migrations, repositories, and a separate PostgreSQL API |
| Legacy data migration | Import and verification tools for an existing `data/db.json` snapshot |
| Authentication | PostgreSQL-backed username/password login with JWT; organizer-created accounts |
| Roles | `STUDENT`, `JUDGE`, and `ADMIN` exist in the database; **complete role-based authorization is not implemented** |
| Practice matches | Local process queue, persisted match records/history, replay files and practice Elo |
| Official tournaments and Elo-based pairing | **Not implemented end-to-end** |
| Restart/recovery | Queued database matches are re-enqueued at startup; interrupted running matches are marked failed (not resumed) |
| Multi-host runner, failover, LAN-offline sync, high-load support | **Not implemented or not validated** |

**Important:** The existing code runs an **8×8** game. Support for different board sizes, rule packs, and annual game changes is an architectural goal, **not** a current capability. Do not confuse mock tournament UI content with persisted competition data.

## 2. Architecture

```text
Browser: public/ (HTML / CSS / JavaScript)
   | HTTP JSON API + WebSocket updates
   v
server/index-postgres.js              Development PostgreSQL API
   |-- server/pg/repository.js         Prisma queries and writes
   |-- server/pg/adapters.js           PostgreSQL-to-frontend/runner contracts
   |-- server/pg/jobs.js               In-process practice match queue
   |-- server/engine.js                OTT game rules / match engine
   `-- server/bot-runner.js            Local Docker execution
           |
           +-- Python / Java / C containers
           +-- data/bots/ (source/build files, local)
           `-- data/M-*.json (replay files, local)

PostgreSQL 17 <-- Prisma Client <-- repository / job code

server/index.js + server/store.js      Legacy JSON backend, kept for reference
```

Match metadata, histories, submission metadata, accounts, and practice ratings are stored in PostgreSQL in the new API. **Bot source files and replay payloads still live on the local filesystem**, under `data/`; PostgreSQL is **not** a complete backup of those files. The match queue and active Docker jobs remain within one Node.js process.

## 3. Prerequisites

- **Node.js 20+** (Node.js 22 is a suitable local development choice) and npm.
- **Docker Desktop with Linux containers**, or Docker Engine accessible from your shell. WSL2 + Ubuntu is supported as a developer environment.
- Git and a terminal (commands below use **Bash / Ubuntu / WSL**).
- Free host port **3001** for the PostgreSQL API and **5433** for PostgreSQL.
- Internet access may be needed for the first `npm ci` and Docker image pulls. Offline tournament hosting is **not** established by this setup.

Confirm prerequisites:

```bash
node --version
npm --version
docker info
docker compose version
```

## 4. Quick start — clean clone with PostgreSQL

These instructions create a **new, empty local database**. You **do not need** the original developer's `data/db.json`, imported bots, or replays to start the app. Commands are run from the repository root.

### 4.1 Clone the working branch

```bash
git clone https://github.com/trankhoaasafaaa/OTTv2.git
cd OTTv2
git switch refactor/phase-1-foundation
npm ci
```

### 4.2 Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and replace the example values. Make `POSTGRES_PASSWORD` and the password embedded in `DATABASE_URL` **match**. Avoid URL-special characters in the password unless properly URL-encoded. To generate an appropriate JWT secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the resulting string as `JWT_SECRET` in `.env`. **Do not commit `.env` or share your secrets.** The included example uses PostgreSQL user `ott`, database `ottv2`, and port `5433`:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3001
POSTGRES_PASSWORD=choose_a_local_password
DATABASE_URL="postgresql://ott:choose_a_local_password@127.0.0.1:5433/ottv2?schema=public"
JWT_SECRET=paste_a_generated_secret_of_at_least_32_characters
ALLOW_SELF_REGISTER=false
WORKER_CONCURRENCY=2
```

For this development branch, leave `HOST=127.0.0.1`. It is **not configured for safe Internet exposure**.

### 4.3 Start PostgreSQL and apply migrations

```bash
docker compose up -d db
docker compose ps
npx prisma migrate deploy
npx prisma generate
node scripts/check-db.cjs
```

`migrate deploy` applies committed migrations to your local database. Use `npx prisma migrate dev` **only when intentionally modifying the Prisma schema while developing**, and commit the new migration. Do **not** use `prisma migrate reset` on a database containing valuable data.

### 4.4 Initialize submission settings for a fresh database

A new database has no `AppSetting` rows. The PostgreSQL API treats submission uploads as **closed** until `submissionsOpen` is explicitly set. Run this once for a development database where you want uploads enabled:

```bash
node - <<'NODE'
require('dotenv/config');
const prisma = require('./server/db');
prisma.appSetting.upsert({
  where: { key: 'submissionsOpen' },
  update: { value: true },
  create: { key: 'submissionsOpen', value: true }
}).then(() => console.log('Development bot submissions: OPEN'))
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
NODE
```

This is **development setup**, not an authorization policy for a real tournament. Revisit submission windows and organizer permissions before deploying beyond localhost.

### 4.5 Create your first account

Public self-registration is disabled by default. Accounts are provisioned by an organizer via `scripts/create-account.cjs`:

```bash
read -rsp 'Password for student1: ' PW; echo
OTT_NEW_PASSWORD="$PW" node scripts/create-account.cjs student1 STUDENT
unset PW
```

Use a password of **8–128 characters**. Supported database role values: `STUDENT`, `JUDGE`, `ADMIN`. **Assigning `JUDGE` or `ADMIN` does not yet enable a complete permission system**; treat these roles as data-model groundwork.

### 4.6 Start and verify the PostgreSQL API

```bash
PORT=3001 npm run dev:pg
```

Open **http://127.0.0.1:3001** and sign in using the new account. In a **second terminal**, run:

```bash
curl -s http://127.0.0.1:3001/api/health
SMOKE_BASE_URL=http://127.0.0.1:3001 node scripts/smoke-phase67.cjs
```

The health response must report `"persistence":"PostgreSQL"`, and the smoke script should report `Smoke test PASSED`. That script verifies the public endpoints and basic access restrictions; it **does not** test an authenticated upload, Docker match, or full recovery.

### 4.7 Try a bot and a match

1. Ensure Docker Desktop / Docker Engine is running (`docker info`).
2. Sign in to OTT Arena at port 3001.
3. Open **My Submissions** and upload a single-file Python, Java, or C bot. Source templates are in `examples/bots/`.
4. Use the **Challenge** flow with **your own** submission to request a practice match against another stored bot. A first submission may not have an opponent yet.
5. Inspect the match in **Match Arena**, and verify the replay and leaderboard where applicable.

New uploads may also trigger an automatic local practice match when another bot and Docker are available. **Manual choice of both opponent submission IDs is disabled** in this PostgreSQL API. A demo match uses built-in engine strategies; actual submitted-bot matches require Docker.

## 5. Legacy JSON backend vs. PostgreSQL backend

These two entry points are deliberately separate during the refactor:

| Command | Backend | Purpose |
| --- | --- | --- |
| `npm start` | `server/index.js` — JSON persistence | Legacy behavior; **not** the PostgreSQL API |
| `npm run dev` | Legacy JSON server with watch mode | Legacy development |
| `npm run dev:pg` | `server/index-postgres.js` — PostgreSQL | **Use this for Phase 6+ development** |
| `npm run seed` | `server/seed.js` — writes JSON data | **Not** a PostgreSQL seeder |

The frontend retains some legacy JSON response shapes. `server/pg/adapters.js` maps Prisma records to the current API contract. Do not remove these adapters without updating the frontend and tests together.

## 6. Database, data files and migration

### Prisma reference

- `prisma/schema.prisma`: database models and enum definitions.
- `prisma/migrations/`: versioned SQL migrations. **Commit these.**
- `server/db.js`: shared Prisma Client connection.
- `server/pg/repository.js`: PostgreSQL access methods.
- `server/pg/jobs.js`: practice match lifecycle and rating writes.

Useful commands:

```bash
npx prisma validate
npx prisma migrate status
npx prisma generate
npm run db:check
npx prisma studio
```

### Migrating an existing developer's JSON snapshot (optional)

Only follow this section if you already have a **legacy** `data/db.json` with related `data/bots/` files and match replay JSON files. **Do not run this importer on a clean teammate database** or on a live, changing snapshot.

1. Stop the legacy API and any processes writing the legacy files.
2. Back up `data/` **and** PostgreSQL before making changes.
3. Apply committed Prisma migrations, then run:

```bash
node scripts/import-legacy-data.cjs --check
node scripts/import-legacy-data.cjs --apply
node scripts/verify-legacy-data.cjs
node scripts/check-phase67.cjs
```

`--check` validates the old snapshot without importing. `--apply` writes imported records. `verify-legacy-data.cjs` compares legacy values and local file checksums with PostgreSQL; it requires the original files to remain available. The importer deliberately preserves ownerless legacy submissions with `userId = null`; **do not silently assign them to another user**.

After the PostgreSQL API begins accepting **new** data, the database may contain more rows than the legacy snapshot. `check-phase67.cjs` expects imported nonempty data and an `AppSetting` row; it is **not** a clean-install check. Likewise, the importer is a one-time compatibility tool, **not** an ongoing sync between the JSON and PostgreSQL backends.

### Backups

Backing up **only PostgreSQL is insufficient**: uploaded source files, build data, and replay files are local under `data/`. Back up the database and relevant `data/` together, and preserve consistency while taking snapshots. Neither source/replay files nor DB dumps belong in Git history.

## 7. Bot protocol (JSON Lines v1)

Each submitted bot is a **single long-running process**. For every turn it reads **one JSON object per line** from standard input and writes **one JSON action per line** to standard output. Flush output promptly; send diagnostics to **stderr**, not stdout.

The observation includes:

- `protocolVersion`: `"1.0"`
- `game`: `"ott-rps"`
- `owner`: `"p1"` or `"p2"`
- `turn`: current turn number
- `board`: 8×8 array of empty cells (`null`) or piece objects, e.g. `{ "id": "a0", "type": "rock", "owner": "p1" }`
- `moves` and `legalActions`: permitted actions, including `from` / `to` coordinates
- `goal`: `[0,7]` for `p1` or `[7,0]` for `p2`

Example action written to stdout:

```json
{"from":[7,1],"to":[6,2]}
```

The runner also accepts a wrapped action such as:

```json
{"type":"action","action":{"from":[7,1],"to":[6,2]}}
```

Coordinates are **zero-based `[row,column]`**. Current engine rules:

- The current board is **8×8**, not 9×9.
- A piece moves **one square in any of eight directions**.
- Rock captures scissors; scissors captures paper; paper captures rock.
- Friendly pieces block movement; equal-type enemy pieces cannot be captured.
- `p1` aims for `[0,7]` (`h8`); `p2` aims for `[7,0]` (`a1`).
- Reaching the goal or eliminating the opposing side wins. If the move limit is reached without a winner, the result is a draw.
- Illegal actions, malformed responses, crashes and timeouts can cause a forfeit.

### Supported languages

| Language | Submission format | Runtime/build environment |
| --- | --- | --- |
| Python | One `.py` file | Python 3.12 |
| Java | One `.java` file; public class name matches filename | Java 21 |
| C | One `.c` file | GCC, C11 |

Only single-file source submissions are currently supported; no external packages or ZIP uploads. See `examples/bots/` for examples. Submitted sources are run inside Docker, **not directly on the Node.js host**.

The Docker runner uses network isolation, reduced privileges, read-only root filesystems, process/CPU/memory limits, and per-turn timeouts. This is a useful development precaution, **not sufficient proof of secure isolation for untrusted code at university scale**. On the first run, language images may be downloaded.

## 8. Development and testing

Run the following from the repository root:

```bash
npm test                                    # existing test suite (includes legacy behavior)
node --test tests/phase67-adapters.test.js # Prisma/frontend/runner adapter unit tests
npm run db:check                            # PostgreSQL connection and table counts
node scripts/check-phase67.cjs             # imported Phase 6 data preflight; not for empty DBs
SMOKE_BASE_URL=http://127.0.0.1:3001 node scripts/smoke-phase67.cjs
```

**Passing these tests is not proof of production readiness.** Before reviewing or merging a feature, manually test authentication, bot ownership, source upload, an actual Docker match, result persistence, replay integrity, and service restart behavior. Note that the current recovery routine re-enqueues `QUEUED` matches but marks previously `RUNNING` matches as `FAILED` after restart.

### Common troubleshooting

| Symptom | Check |
| --- | --- |
| `EADDRINUSE` on port 3001 | Another server is already bound: `ss -ltnp \| grep ':3001'` |
| Prisma database connection error | Docker is running, container is healthy, `DATABASE_URL` uses port `5433`, password matches Docker volume credentials |
| `Unknown argument` in Prisma | Schema/migrations and generated Prisma Client may be out of sync; run `npx prisma validate`, check migrations, then `npx prisma generate` |
| Login works but upload is forbidden | Check `AppSetting(submissionsOpen)` and verify you signed in |
| Bot match cannot start | Check `docker info`, image availability, an opponent submission, and worker logs |
| Bot/replay missing after clean clone | Runtime `data/` files are intentionally not versioned; create fresh bot submissions |
| Website reports JSON persistence | You started `npm start` rather than `npm run dev:pg` |

**Existing PostgreSQL volumes retain the original database password.** Changing `POSTGRES_PASSWORD` in `.env` does not automatically update credentials in an already initialized Docker volume. Do not destroy the volume merely to resolve an authentication error if it contains valuable data.

## 9. API overview (PostgreSQL development server)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Server status and PostgreSQL connectivity |
| GET | `/api/game` | Current game description |
| GET | `/api/overview` | Aggregate counts and recent matches |
| POST | `/api/auth/login` | Sign in; receive JWT |
| GET | `/api/auth/me` | Authenticated user, bots, recent matches |
| POST | `/api/auth/register` | Disabled by default (403) |
| GET / POST | `/api/submissions` | List / submit source files (POST requires login) |
| GET | `/api/leaderboard` | Practice bot ratings |
| GET / POST | `/api/matches` | List matches / request a demo or challenge match (POST requires login) |
| GET | `/api/matches/:id` | Match status and metadata |
| GET | `/api/matches/:id/replay` | Verified local replay of a completed match |
| GET | `/api/settings` | Submission settings |
| GET | `/api/judge/status` | Local Docker/queue information; **not a protected organizer dashboard** |
| WS | `/ws` | Match state notifications; **not an authenticated private channel** |

`POST /api/matches` with no submission IDs requests a **demo** match. `POST /api/matches` with only `submissionA` requests a **challenge** using a bot owned by the signed-in user; the API chooses the opponent. Passing both `submissionA` and `submissionB` is rejected in this development backend.

## 10. Repository layout

```text
OTTv2/
├── public/                      Browser UI, styles and API bridge
├── server/
│   ├── index.js                 Legacy JSON HTTP server
│   ├── index-postgres.js        Phase 6 PostgreSQL HTTP server
│   ├── db.js                    Prisma Client
│   ├── store.js                 Legacy JSON file store
│   ├── engine.js                Game rules / match engine
│   ├── bot-runner.js            Docker bot build and execution
│   ├── pg/                      PostgreSQL repositories, adapters and jobs
│   └── repositories/            Refactor groundwork; verify active usage before extending
├── prisma/
│   ├── schema.prisma            Models and enums
│   └── migrations/              Versioned SQL migrations
├── scripts/                     Database/import/account/test utilities
├── tests/                       Automated tests
├── examples/bots/               Python, Java and C examples
├── data/                        Local runtime data (not committed)
├── compose.yaml                 Local PostgreSQL 17 container
├── .env.example                 Safe configuration template
└── package.json                 npm scripts and dependencies
```

Some modules are refactor groundwork and are not necessarily used by the active PostgreSQL API. Trace dependencies before deleting or editing code.

## 11. Team workflow

The development foundation is on `refactor/phase-1-foundation`; do not work directly on the stable `main` branch until a reviewed merge is approved.

```bash
git fetch origin
git switch refactor/phase-1-foundation
git pull --ff-only

git switch -c feature/your-feature-name
# Make and test changes
git add <specific-files>
git commit -m "feat: explain the change"
git push -u origin feature/your-feature-name
```

Open a **Pull Request** into the agreed integration branch. Include the purpose, files changed, migration impact, security implications, and evidence of testing. Review database migrations with other contributors; do not edit already-applied migration SQL to hide a schema change. Avoid committing `.env`, databases, passwords, production/user data, local replays, `node_modules/`, `*.bak`, or Windows `*:Zone.Identifier` metadata.

### When modifying the game

Prefer containing rule changes within the game engine/library and explicit adapters. Do not hard-code new game rules into authentication, persistence, tournaments, or HTTP routing. Version each ruleset and ensure existing matches retain their rule version and replay information. **The current code does not yet guarantee that separation**; establishing it is upcoming refactor work.

## 12. Roadmap — not yet implemented

Priorities for subsequent phases (subject to team/lecturer approval):

1. **Complete authentication and authorization:** secure session lifecycle, permission checks, organizer-only operations, and audit logs.
2. **Tournament domain:** membership, locked bot versions, eligibility, Elo-based pairing, scheduling, standings and verified official results.
3. **Game modularity:** stable game library interfaces, ruleset/version/hash contracts, validation and replay compatibility across annual game changes.
4. **Reliable match execution:** durable queue, worker leasing, idempotent results, retries, recovery, and a dedicated runner/worker service.
5. **Organizer operations:** safe mid-event configuration changes, approval/version boundaries, logs and recovery controls.
6. **Offline/LAN events:** independent local deployment plus a conflict-safe synchronization process back to the main platform.
7. **Scalability and security testing:** workload modelling and measured capacity before attempting tournaments with thousands of participants.

The desired production deployment is **university-operated infrastructure**; any local development setup or free-tier demo hosting is not that production environment.

## 13. Safety and project scope

This repository is a **collaborative development prototype**. Do not expose the PostgreSQL development API or bot runner directly to the public Internet. Its role labels are not a substitute for enforced authorization; its local Docker restrictions are not a hardened multi-tenant judge; and its in-process queue cannot provide distributed resilience. Results and replay files must be backed up and audited before use for graded or official competitions.

If you are joining the project, start with **Section 4**, run the tests in **Section 8**, and open a feature branch following **Section 11**.
