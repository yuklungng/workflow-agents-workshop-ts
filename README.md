# Render Workflow Agents Workshop

A hands-on workshop that builds **one agentic code-review use case** and runs it on
**three Render execution substrates**: in-process, worker + queue, and Render
Workflows. 

The workshop teaches the trade-offs of each pattern by moving the same multi-agent
PR reviewer (`security`, `performance`, `ux`, then a `judge`) across progressively more
durable execution models. You start by hand-rolling queue coordination, then let
Render Workflows make all of it declarative until the only thing you author is a
plain async function and a config object.

For someone facilitating this workshop, start with [`facilitator/GUIDE.md`](facilitator/GUIDE.md)
and the guided walkthrough in [`docs/`](docs).

## The three patterns

| Pattern | Package | Substrate | Render primitives | You own |
| --- | --- | --- | --- | --- |
| **1 — Naive** | [`packages/naive-agent`](packages/naive-agent) | Agent runs in-process, inside the web request | Web Service + Postgres | Nothing — but no scale or durability |
| **2 — Worker** | [`packages/worker-agents`](packages/worker-agents) | Thin producer + background worker over a Valkey queue | Web Service + Background Worker + Valkey + Postgres | The queue, consumer group, acks, retries, pub/sub |
| **3 — Workflows** | [`packages/workflow-agents`](packages/workflow-agents) | Each agent is a Render `task()` in its own container | Web Service + Workflows + Postgres | Nothing — Render does the coordination |

The agent code lives in the shared [`@workshop/agent`](shared/agent) package. The substrate decides how it is invoked.

## Running It

This is an npm-workspaces monorepo (Node >= 22.12). Install everything from the root:

```sh
npm install
```

No API key is required to run anything: with no key set, [`@workshop/agent`](shared/agent)
falls back to a deterministic **mock** model so the full pipeline runs offline. Set
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for real reviews (or force the mock with
`AGENT_MODEL=mock`).

Each app reads the root `.env` (Docker Compose loads it automatically; local
`npm run *:dev` scripts load `../../.env` then a package `.env` override if present).
Copy the example if you haven't:

```sh
cp .env.example .env
```

Local services (only what each pattern needs):

```sh
createdb agents_workshop        # Postgres — naive-agent & worker-agents
redis-server &                  # Redis/Valkey — worker-agents only (or: docker run -p 6379:6379 redis)
```

Or run **everything** (Postgres, Redis, and all three patterns) with Docker:

```sh
npm run docker:up               # builds and starts all services
# Pattern 1 → http://localhost:3001
# Pattern 2 → http://localhost:3002
# Pattern 3 → http://localhost:3003  (Render workflow dev server on :8120)
npm run docker:down             # stop and remove containers
```

Pattern 3 in Docker runs `scripts/docker-workflow-dev.sh`: the Render CLI dev server
registers tasks on **:8120**, then the gateway on **:3003** dispatches through it.
Trigger from the UI or: `render workflows tasks list --local` (from your host, against :8120).

Then run any pattern **on the host** (without Docker):

```sh
# Pattern 1 — in-process
npm run naive:dev               # http://localhost:3000

# Pattern 2 — producer + worker (run multiple workers to scale out)
npm run worker:web              # terminal A — http://localhost:3000
npm run worker:worker           # terminal B — one worker
npm run worker:worker           # terminal C — another worker

# Pattern 3 — Render Workflows
npm run dev --workspace @workshop/workflow-agents          # fast in-process shortcut
npm run dev:workflows --workspace @workshop/workflow-agents # Render CLI dev server (host)
```

Open `http://localhost:3000/` for the shared telemetry viewer, paste a public PR URL,
and watch the review run with per-agent findings and spans.

## Workshop Flow

The guided walkthrough lives in [`docs/`](docs) and is meant to be followed in order:

* [`docs/00-setup.md`](docs/00-setup.md) — prerequisites, install, local services, env
* [`docs/01-naive-agent.md`](docs/01-naive-agent.md) — Pattern 1: the in-process baseline and where it breaks
* [`docs/02-worker-agents.md`](docs/02-worker-agents.md) — Pattern 2: queue + worker; **hand-write the ack/retry semantics** in `kv.ts`
* [`docs/03-workflow-agents.md`](docs/03-workflow-agents.md) — Pattern 3: the same fan-out as declarative Render tasks
* [`docs/04-author-a-task.md`](docs/04-author-a-task.md) — the hands-on finale: explore the `your-review` sandbox, compose agents as tasks, plus **bonus points** (reflection loop, MCP tool, HITL gate)
* [`docs/05-future-iterations.md`](docs/05-future-iterations.md) — where to go for production: eval harness, guardrails, circuit breakers, observability deep-dives

The two interactive beats:

* **Session 1 — hand-roll coordination.** In worker-agents you implement `processEntry` in
  [`packages/worker-agents/src/kv.ts`](packages/worker-agents/src/kv.ts) by hand: ack on
  success, leave un-acked for retry on failure. Verify with `npm run test:worker`.
* **Session 2 — let agents author tasks.** In workflow-agents you explore the
  `your-review` sandbox and feel how small the `task()` API surface is —
  the same durability that took a whole queue in Session 1 is now a config object.

## Repository Structure

```
packages/
  naive-agent/      Pattern 1 — in-process web service (Hono)
  worker-agents/    Pattern 2 — producer web + background worker over Valkey
  workflow-agents/  Pattern 3 — Render Workflows; gateway + workflow service
shared/
  agent/            @workshop/agent — the constant: LLM loop, model client, agents, runReview
  db/               @workshop/db — telemetry store (Postgres or in-memory): reviews / findings / spans
  ui/               @workshop/ui — mountable Hono telemetry viewer shared by all three
docs/               guided walkthrough (00–05)
facilitator/        facilitator notes and exercise solutions
tests/              unit / integration / e2e (run against the mock model)
```

### Shared packages

* **[`@workshop/agent`](shared/agent)** — the substrate-agnostic core. `runReview()`, the
  `defineAgent` reviewers (`securityReviewer`, `performanceReviewer`, `uxReviewer`,
  `judge`), `prepareDiff`/`filterDiff`, the provider-agnostic LLM loop, and the mock
  client. Nothing here knows about Render.
* **[`@workshop/db`](shared/db)** — the durable telemetry record the viewer reads. Auto-selects
  Postgres when `DATABASE_URL` is set, in-memory otherwise.
* **[`@workshop/ui`](shared/ui)** — a single mountable Hono router that renders the reviews
  table with drill-in to findings and agent spans.

## The Code-Review Pipeline

Every pattern runs the same review:

```
prepareDiff → filterDiff → [ security ‖ performance ‖ ux? ] → judge
```

* `prepareDiff` turns a GitHub PR URL into per-file patches (public repos need no token).
* `filterDiff` drops noise (lock files, minified assets, source maps, bundles).
* `security` and `performance` always run in parallel; `ux` joins when the diff touches
  frontend files (`.tsx`, `.jsx`, `.vue`, `.css`, …).
* `judge` consolidates findings into an approve / request-changes verdict.

Trigger one against any public PR — no webhook needed:

```sh
curl -s -X POST http://localhost:3000/api/reviews \
  -H 'content-type: application/json' \
  -d '{"prUrl":"https://github.com/octocat/Hello-World/pull/9681"}'
```

## Deploying to Render

Each pattern ships its own Blueprint:

* [`packages/naive-agent/render.yaml`](packages/naive-agent/render.yaml) — Web Service + Postgres
* [`packages/worker-agents/render.yaml`](packages/worker-agents/render.yaml) — Web Service + Background Worker + Valkey + Postgres (scale the worker via `numInstances`)
* [`packages/workflow-agents/render.yaml`](packages/workflow-agents/render.yaml) — Web Service + Postgres; create the Workflow service in the dashboard

Deploy a Blueprint, push to your repo, and Render builds and wires the services together.
In production, `RENDER_USE_LOCAL_DEV=false` makes the Pattern 3 gateway dispatch real
Workflow tasks.

## Configuration

All patterns read the same env (copy [`.env.example`](.env.example) into each package):

| Var | Used by | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | all | optional; deterministic mock model if absent |
| `AGENT_MODEL=mock` | all | force the mock model even with a key |
| `DATABASE_URL` | naive-agent, worker-agents, workflow-agents | Postgres; in-memory fallback when unset |
| `REDIS_URL` | worker-agents | queue + pub/sub; defaults to `redis://127.0.0.1:6379` |
| `PORT` | web tiers | defaults to `3000` |
| `GITHUB_TOKEN` | all | optional; raises rate limits / enables private-repo diffs |
| `GITHUB_WEBHOOK_SECRET` | workflow-agents | HMAC secret for webhook verification |
| `WORKFLOW_API_KEY` | workflow-agents | bearer token protecting `/api/reviews` and `/webhooks/*` |
| `RENDER_USE_LOCAL_DEV` | workflow-agents | `true` for local dev; without `RENDER_LOCAL_DEV_URL`, runs in-process |
| `RENDER_LOCAL_DEV_URL` | workflow-agents | when set (Docker / `dev:workflows`), SDK dispatches to Render CLI dev server |
| `RENDER_API_KEY` | workflow-agents | required in production; Docker local dev uses `local-dev` |

## Testing

All suites run against the deterministic mock model, so they need no API key:

```sh
npm test                 # everything
npm run test:unit        # pure logic (agents, filterDiff, model, parseDecision, loader, …)
npm run test:integration # per-pattern app + the worker kv contract
npm run test:e2e         # end-to-end naive + workflow flows
npm run test:worker      # just the worker ack/retry contract (the Session 1 exercise)
npm run typecheck        # TypeScript across every workspace
```

Tests live under [`tests/`](tests) (`unit/`, `integration/`, `e2e/`). The
`worker-kv` integration test is the red→green check for the Session 1 exercise.

## Notes

* This is an **npm workspaces** monorepo (`shared/*` + the three `packages/*`); install
  from the root with a single `npm install`.
* The mock model means the entire pipeline — all three patterns and the full test suite —
  runs offline with zero credentials.
* Pattern 3 uses the Render SDK (`@renderinc/sdk/workflows`): workflows are
  auto-discovered from `src/workflows/` (any subfolder with an `index.ts` exporting a
  `task()`), so adding a workflow needs no manual registration.
