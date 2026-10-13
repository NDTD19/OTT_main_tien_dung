# OTT Arena — Submitted Bots Edition

**An integrated local Battlecode-style bot competition prototype.** Built from the approved bright pixel-platformer frontend (with Set B-inspired Gold/Blue Rock/Paper/Scissors pieces) and the OTT 8×8 authoritative match engine.

## Start in 3 steps

1. Install **Node.js 20+** and **Docker Desktop (Linux containers)** or a Linux Docker Engine. Start Docker Desktop first.
2. Unzip the project and open a terminal **inside `ott-arena-battlecode`**.
3. Run:

```bash
npm start
```

Open **http://127.0.0.1:3000**.

You do **not** need `npm install`. The Node server uses built-in modules only.

### Quick test with included bots

Four ready-to-submit example sources have already been seeded into this package: **Python Greedy, Python Random, Java Main, C bot**. You can also submit your own single source files.

In the website:

1. Open **My Submissions** to see the example source versions or upload a new `.py`, `.java`, `.c` file.
2. Open **Judge Console → Submitted Bot vs Submitted Bot**.
3. Select a different Gold bot and Blue bot; set move limit / who moves first.
4. Click **Run submitted bots**. The backend will prepare isolated containers, compile Java/C if needed, and execute *your submitted code*.
5. After the match completes, the browser opens **Match Arena** with its **real replay**, result, and turn log.
6. Check **Leaderboard** for local practice Elo updates. Matches between the same submission ID are rejected.

**First-run note:** the Docker engine may have to download language images. This can take a while. You can pre-pull them:

```bash
docker pull python:3.12-alpine
docker pull eclipse-temurin:21-jdk
docker pull eclipse-temurin:21-jre
docker pull gcc:13-bookworm
docker pull debian:bookworm-slim
```

Without Docker, use **Judge Console → Run built-in demo match**. The system **never** executes untrusted submitted code on the host as a fallback.

## Submit bot protocol (JSON Lines v1)

Each bot is a **single long-running process**, reading **one JSON object per line from standard input**, and writing **exactly one JSON action per line to standard output**. Avoid additional stdout logging. Send debug logs to stderr.

Example observation (simplified):

```json
{
  "protocolVersion": "1.0",
  "game": "ott-rps",
  "owner": "p1",
  "turn": 1,
  "board": [[null]],
  "goal": [0, 7],
  "moves": [
    {"from": [7, 1], "to": [6, 2], "owner": "p1", "unit": "rock", "capture": false}
  ]
}
```

The actual `board` is an **8×8** array containing `null` or `{ "id": "a0", "type": "rock", "owner": "p1" }`. The input also supplies `legalActions`, an alias for `moves`.

Example action output:

```json
{"from":[7,1],"to":[6,2]}
```

A supported alternative is `{"type":"action","action":{"from":[7,1],"to":[6,2]}}`.

**Coordinates are `[row,column]`, zero-based.** The objective is the opposite corner: Gold `p1` targets `h8` / `[0,7]`, Blue `p2` targets `a1` / `[7,0]`. Move one square horizontally, vertically, or diagonally. Rock beats scissors, scissors beat paper, paper beats rock. No friendly captures or captures of equal types. Reaching goal or eliminating the other player's pieces wins. If the move cap is reached without victory, the match is a draw.

The engine validates **every** submitted action. Illegal moves and malformed bot output forfeit the match. A runtime crash or per-turn safety timeout also forfeits the match and records the cause.

### Language rules

- **Python 3.12:** one `.py` source file, stdin loop with `print(..., flush=True)`.
- **Java 21:** one `.java` file; **public class name must match filename** (e.g. `Main.java` / `public class Main`). Standard library only; read one line and `System.out.flush()` per action.
- **C11:** one `.c` file; executable compiled with GCC; `fgets` / `printf` / `fflush(stdout)` per action.

Sample bots live in `examples/bots/`. Copy them as starter templates. Single-file submissions only; external packages and ZIP submissions are not implemented.

## How a real submitted match works

```text
Frontend upload -> POST /api/submissions -> stored source + hash
Judge Console -> POST /api/matches -> queued job ID
Local Match Queue -> Docker sandbox build (once per submitted version)
                 -> launch bot A process and bot B process separately
                 -> send each bot its observation via stdin JSONL
                 -> read next action from stdout JSONL
                 -> validate and apply action in authoritative engine
                 -> winner / forfeit / draw -> saved replay + local Elo
Frontend polls match status -> opens actual replay
```

The built-in **Demo match** uses Greedy/Random engine strategies; the separate **Submitted Bot match** executes **exactly the selected submission IDs**. It does not silently substitute demo bots.

### Safety / constraints

- All submitted code is run using `docker run` **without network**, a read-only root filesystem, non-root user, dropped capabilities, no-new-privileges, process/CPU/memory quotas, and separate per-bot containers.
- Runtime defaults: 256 MB RAM per bot, 1 CPU share, 64-process limit, **5 seconds wall-clock safety timeout per turn** (`BOT_TURN_MS` can override within an allowed range).
- Build defaults: 512 MB RAM, 45-second build timeout. Initial image pulling may take longer.
- Source upload: **500 KB** per file; one source file per submission; names use ASCII letters, digits, underscores (and must start with a letter).
- A maximum of 1 local match runs at a time; up to 20 waiting jobs. Matches are not distributed in this version.
- Source code, compilation artifacts, match replays and local Elo state live under `data/` and are **not published through static HTTP routes**.

**This is a local prototype, not a production judge for 4,000 students.** Docker restrictions significantly reduce risk, but Docker alone is not a hardened multi-tenant security boundary. For production, use a dedicated isolated worker fleet with stronger sandboxing (gVisor/Firecracker or equivalent), authentication and user permissions, anti-CSRF measures, per-user quotas, resilient PostgreSQL+queue storage, worker leases, version pinning and replay verification. The server binds to `127.0.0.1` by default; **do not expose its unauthenticated APIs to the public Internet**.

**Local Elo is for practice only.** Users could submit their own bots and farm their ratings; it is not an official tournament ranking system until identities and matchmaking are enforced.

## Developer commands

```bash
npm start             # start HTTP server (default 127.0.0.1:3000)
npm run dev           # watch files and restart server
npm test              # engine, interface, protocol and security checks
npm run seed          # add the included sample bot submissions if missing
```

To use a different port, set `PORT`. On Linux/macOS: `PORT=3001 npm start`; on Windows PowerShell: `$env:PORT=3001; npm start`.

### Local API

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/health` | server, version and queue status |
| GET | `/api/judge/status` | Docker availability and images |
| GET | `/api/game` | official game description |
| GET / POST | `/api/submissions` | list / submit bot source |
| GET | `/api/leaderboard` | practice Elo of submitted bots |
| GET / POST | `/api/matches` | list / queue a match |
| GET | `/api/matches/:id` | queued, running, completed or failed status |
| GET | `/api/matches/:id/replay` | authoritative replay for completed matches |

Submitted match JSON example:

```json
{
  "submissionA": "SUB-ABCDEF12",
  "submissionB": "SUB-1234ABCD",
  "maxMoves": 200,
  "pieces": 6,
  "first": "Random"
}
```

`POST /api/matches` responds **202 Accepted** with a match ID. Poll `/api/matches/:id` until completed, then download the replay. Use `{"a":"Greedy","b":"Random"}` without submission IDs to queue a separate built-in demo match.

## Files

- `public/` approved pixel-themed frontend + real API bridge
- `server/index.js` backend HTTP API, persistence, queue and match status
- `server/engine.js` authoritative OTT RPS engine
- `server/bot-runner.js` Docker-only Python/Java/C build + JSON-lines bot execution
- `server/store.js` JSON storage
- `server/seed.js` example bot seeder
- `examples/bots/` submission examples for all supported languages
- `tests/` automated tests
- `data/` local mutable state, source files and replays (keep private)
