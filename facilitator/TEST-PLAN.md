# Test Plan — Render Agents Workshop

A step-by-step plan and checklist to verify **every shared package and every
pattern end-to-end**, run the way you'd actually facilitate the workshop. Work
through the phases in order: Phase 1 is the fast offline signal; Phases 2–4 are
the live demos; Phase 5 is the full stack together.

Companion docs: [`GUIDE.md`](GUIDE.md) (teaching layer) and [`../docs`](../docs)
(`00`–`05`).

## What's under test

| Area | Package | Covered in |
| --- | --- | --- |
| Agent core (`runReview`, reviewers, `prepareDiff`/`filterDiff`, LLM loop, mock model, tools/MCP) | `shared/agent` | Phase 1, 2, 4 |
| Telemetry store (Postgres + in-memory fallback) | `shared/db` | Phase 1, 6 |
| Telemetry viewer (reviews → findings → spans) | `shared/ui` | Phase 1, 2–4 |
| Pattern 1 — in-process | `packages/naive-agent` | Phase 2 |
| Pattern 2 — queue + worker (Lab 1) | `packages/worker-agents` | Phase 3 |
| Pattern 3 — Render Workflows (Lab 2) | `packages/workflow-agents` | Phase 4 |
| Full stack via Docker | root `docker-compose.yml` | Phase 5 |

## Before you start — two gotchas

1. **`processEntry` throws by design.** It's the unsolved Lab 1 starter in
   [`packages/worker-agents/src/kv.ts`](../packages/worker-agents/src/kv.ts), so
   `npm test`, `npm run test:worker`, and `npm run test:integration` fail on the
   `worker-kv` contract until you implement it (solution in
   [`GUIDE.md`](GUIDE.md) §8). Implement it first for a green baseline, or leave
   it to demo the red→green moment.
2. **Services aren't required for everything.** Phases 1, 2, and 4 run **offline**
   with no Postgres/Redis (in-memory DB + mock model). **Phase 3** needs Redis
   (and Postgres for the resilience demo); **Phase 5** needs the Docker daemon.

---

## Phase 0 — Environment preflight

```sh
cd workflow-agents-workshop
node -v                 # expect >= 22.12
npm install             # idempotent; confirms clean install
cp .env.example .env    # root env (mock model by default — no key needed)
```

- [ ] Node >= 22.12 (`node -v`)
- [ ] `npm install` completes clean from root
- [ ] `.env` exists at repo root (leave keys blank → mock model)
- [ ] Decide model: mock (default, offline) vs real (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`)
- [ ] Redis for Pattern 2: `docker run -d -p 6379:6379 redis` (start Docker daemon first)
- [ ] (Optional, durable telemetry) Postgres: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=workshop -e POSTGRES_USER=workshop -e POSTGRES_DB=agents_workshop postgres:16-alpine`
- [ ] `render` CLI installed (`render --version`) — needed for Phase 4c
- [ ] Two demo PRs picked: one small, one touching frontend files (`.tsx/.jsx/.vue/.css`) so the `ux` reviewer fires

---

## Phase 1 — Automated suite (all shared packages + per-pattern logic)

Run first. Fastest full-surface signal; needs no services.

```sh
npm run typecheck          # TS across every workspace + tests
npm run test:unit          # shared/agent + shared/db + shared/ui logic
npm run test:integration   # per-pattern app + worker kv contract
npm run test:e2e           # naive + workflow end-to-end (mock)
npm test                   # everything at once
```

- [ ] `typecheck` green across all workspaces
- [ ] **agent core** — `tests/unit/agents.test.ts`, `model.test.ts`, `parseDecision.test.ts`, `filterDiff.test.ts`, `github.test.ts`, `tools.test.ts`
- [ ] **db** — `tests/unit/db-memory.test.ts`
- [ ] **ui** — `tests/unit/ui.test.ts`
- [ ] **workflow loader** — `tests/unit/loader.test.ts`
- [ ] **naive integration** — `tests/integration/naive-app.test.ts`
- [ ] **worker app integration** — `tests/integration/worker-app.test.ts`
- [ ] **run-review integration** — `tests/integration/run-review.test.ts`
- [ ] **agentTask integration** — `tests/integration/agentTask.test.ts`
- [ ] **workflow app integration** — `tests/integration/workflow-app.test.ts`
- [ ] **e2e** — `tests/e2e/naive.e2e.test.ts`, `tests/e2e/workflow.e2e.test.ts`

> `npm run test:worker` (the `worker-kv` contract) is **Lab 1** — RED until
> `processEntry` is implemented in Phase 3.

---

## Phase 2 — Pattern 1: naive-agent (in-process)

```sh
npm run naive:dev          # http://localhost:3000 (in-memory DB if DATABASE_URL unset)
```

- [ ] `GET /healthz` → `ok`
- [ ] Viewer loads at `http://localhost:3000/`
- [ ] Submit small PR via UI → row appears, status → `done`, verdict shown
- [ ] API: `curl -s -X POST localhost:3000/api/reviews -H 'content-type: application/json' -d '{"prUrl":"https://github.com/octocat/Hello-World/pull/9681"}'` → `{ id, verdict }`
- [ ] No `prUrl` → `400`
- [ ] Drill into a row → per-agent **findings** + **spans** (LLM turns / tool calls)
- [ ] Frontend PR → `ux` reviewer fires (3 reviewers, not 2)
- [ ] (Durable variant) restart with `DATABASE_URL` set → reviews persist
- [ ] "Break it" beat: large PR / slow model blocks the request (motivation for Pattern 2)

---

## Phase 3 — Pattern 2: worker-agents (queue + worker)

### Lab 1 — implement `processEntry`

```sh
# RED first (proves the test is meaningful):
REDIS_URL=redis://127.0.0.1:6379 npm run test:worker
# implement processEntry in packages/worker-agents/src/kv.ts
#   ack on success; leave un-acked (don't rethrow) on failure
# GREEN:
REDIS_URL=redis://127.0.0.1:6379 npm run test:worker
```

- [ ] Redis reachable (`docker run -p 6379:6379 redis`)
- [ ] `test:worker` is **RED** before implementing (baseline)
- [ ] Implement `processEntry` (ack inside `try` after handler; `catch` logs + returns, never rethrows)
- [ ] `test:worker` is **GREEN** (acked-on-success + pending-on-failure)
- [ ] Re-run `npm run test:integration` → `worker-kv` now passes

### Manual e2e (three terminals)

```sh
npm run worker:web         # A — http://localhost:3000 (producer)
npm run worker:worker      # B — worker 1
npm run worker:worker      # C — worker 2 (scale-out)
```

- [ ] `POST /api/reviews` → **`202 { id, status: "queued" }`** (does not block)
- [ ] No `prUrl` → `400`
- [ ] `GET /api/reviews/:id/stream` → SSE progress events until `done`
- [ ] **Concurrency:** submit several PRs fast → workers B & C share the load
- [ ] **Scale-out:** add a 3rd worker → throughput rises, no code change
- [ ] **Resilience:** kill web mid-review → worker finishes; result in Postgres when web restarts (requires `DATABASE_URL`)
- [ ] **Retry:** force a handler failure → message stays pending, redelivered (un-acked); consumer loop keeps running
- [ ] Viewer at `:3000` shows the same reviews/findings/spans as Pattern 1

---

## Phase 4 — Pattern 3: workflow-agents (Render Workflows)

### 4a. Gateway (in-process local dev)

```sh
cd packages/workflow-agents
cp .env.example .env
RENDER_USE_LOCAL_DEV=true npm run dev      # http://localhost:3000
```

- [ ] Startup log lists discovered workflows (`code-review, your-review`), `localDev: true`
- [ ] `GET /healthz` → `{ ok: true }`
- [ ] `POST /api/reviews` → `202 { id }`; review runs in background, viewer shows it complete
- [ ] No `prUrl` → `400`
- [ ] Viewer shows reviews/findings/spans (frontend PR → `ux` task also runs)

### 4b. GitHub webhook adapter

```sh
curl -s -X POST localhost:3000/webhooks/github \
  -H 'content-type: application/json' -H 'x-github-event: pull_request' \
  -d '{"action":"opened","pull_request":{"html_url":"https://github.com/octocat/Hello-World/pull/9681","labels":[]}}'
```

- [ ] `opened` / `reopened` / `synchronize` → `202 { runId, status: "running" }`, review created
- [ ] Non-reviewable action (`closed`/`labeled`) → `202 { ignored: true }`
- [ ] Wrong/missing `x-github-event` header → ignored
- [ ] **Signature:** with `GITHUB_WEBHOOK_SECRET` set, bad/missing `X-Hub-Signature-256` → `401`; correctly HMAC-signed body → accepted
- [ ] **API-key auth:** with `WORKFLOW_API_KEY` set, `POST /api/reviews` and `/webhooks/*` without `Authorization: Bearer …` → `401`; reads stay open

### 4c. Render Workflows CLI (local task runtime)

```sh
npm run dev:workflows                  # A — render workflows dev + gateway
render workflows tasks list --local    # B
# run code-review → input: { "url": "https://github.com/<o>/<r>/pull/<n>", "labels": [] }
```

- [ ] `dev:workflows` starts the local Render runtime
- [ ] `tasks list --local` shows `code-review` **and** `your-review` (auto-discovered, no registration)
- [ ] Run `code-review` → completes; trace shows `prepareDiff` step + parallel reviewer tasks + `judge`
- [ ] Frontend PR → `ux` task appears in fan-out; backend-only PR → it doesn't

### Lab 2 — author a task (`your-review`)

- [ ] **Run as-is:** `your-review` with `{ "url": "...pull/<n>" }` → returns overview/extensions/dropped
- [ ] **Compose an agent as a task:** add `agentTask(securityReviewer)`, return findings → nested `security` task in trace (import is `../../agentTask.js`)
- [ ] **Force a retry:** add `if (Math.random() < 0.5) throw new Error("flaky!")` → Render retries in a fresh instance per `retry` config; **remove after**
- [ ] **Fan out:** `REVIEWERS.map(agentTask)` + `Promise.all` → mirrors `code-review`
- [ ] (Bonus 1) reflection loop on `judge` via repeated `agentTask(judge)`
- [ ] (Bonus 2) MCP tool: `npm i @modelcontextprotocol/sdk -w @workshop/agent` + `defineMcpSource`; tool span appears under agent turns
- [ ] (Bonus 3) HITL gate: `request-changes` → `awaiting-approval`, resolved by a second task

### 4d. Production dispatch path (optional, no real deploy)

- [ ] With `RENDER_USE_LOCAL_DEV=false` (+ `RENDER_API_KEY`), gateway dispatches via `@renderinc/sdk` `startTask`/`get` instead of in-process (full validation requires a deploy)

---

## Phase 5 — Docker all-in-one (full stack)

Start the Docker daemon first.

```sh
npm run docker:up          # builds + starts pg, redis, all 3 patterns
# Pattern 1 → http://localhost:3001
# Pattern 2 → http://localhost:3002
# Pattern 3 → http://localhost:3000
npm run docker:logs
npm run docker:down
```

- [ ] All services healthy (`postgres`, `redis`, `naive-agent`, `worker-web` + `worker`, `workflow-agents`)
- [ ] Submit a PR on each port (3001 / 3002 / 3000) → all complete, share the same Postgres
- [ ] `docker:down` cleanly removes containers

---

## Phase 6 — Cross-cutting matrix

- [ ] **Model:** mock (default) vs real key vs `AGENT_MODEL=mock` override
- [ ] **DB backend:** in-memory (no `DATABASE_URL`) vs Postgres — viewer identical either way
- [ ] **filterDiff:** noise files (lock/min/map/bundle) dropped; `breakGlass` keeps them
- [ ] **Reviewer selection:** `hasFrontendFiles` / `selectReviewers` gate the `ux` reviewer correctly
- [ ] **GitHub:** public PR with no token works; `GITHUB_TOKEN` raises rate limits / enables private
- [ ] **PORT** override respected by all web tiers

---

## Phase 7 — Deploy blueprints (optional, real Render account)

- [ ] `packages/naive-agent/render.yaml` → Web + Postgres
- [ ] `packages/worker-agents/render.yaml` → Web + Worker + Valkey + Postgres (scale worker via `numInstances`)
- [ ] `packages/workflow-agents/render.yaml` → Web + Postgres (+ Workflow service in dashboard), `RENDER_USE_LOCAL_DEV=false`
