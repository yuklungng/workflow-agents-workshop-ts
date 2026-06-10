# workflow-agents

The same code-review agent run on [Render Workflows](https://render.com/docs/workflows).
The agent code is unchanged from `naive-agent` and `worker-agents` (it comes from
[`@workshop/agent`](../../shared/agent)); the only difference is that each agent
runs as its own Render `task()` — with isolation, retries, timeouts, and traces
handled by the platform.

> Guided walkthrough: [docs/03-workflow-agents.md](../../docs/03-workflow-agents.md) ·
> hands-on finale: [docs/04-author-a-task.md](../../docs/04-author-a-task.md)

```
code-review (Render task)
├── prepareDiff   (plain function, in-process)
├── filterDiff    (plain function, in-process)
├── security      (Render task, isolated container) ┐
├── performance   (Render task, isolated container) ├─ Promise.all fan-out
├── ux            (Render task, isolated container) ┘  (ux only if frontend files)
└── judge         (Render task, isolated container)
```

- **Render primitives:** Web Service + **Workflows** + Postgres.
- **What it unlocks:** managed queuing, retries/backoff, per-task compute, parallel
  fan-out, and full traces in the Render Dashboard — none of which you write.
- **What you now own:** nothing. Each agent is wrapped in a `task()` call directly
  in the workflow file — no bridge module, no factory. Everything else is the
  plain TypeScript shared with the other patterns.

## Architecture

Two processes, defined in [`render.yaml`](render.yaml):

| Process | Source | Role |
|---|---|---|
| **Gateway** (web service) | `src/server.ts` | Receives PR submissions / GitHub webhooks, dispatches workflow runs, serves the telemetry viewer. |
| **Workflow service** | `src/workflow.ts` | Registers and runs the task graph; each workflow and agent runs in its own container. |

Workflows are auto-discovered from `src/workflows/` — each subfolder with an
`index.ts` that exports a `task()` is registered, and the folder name becomes the
route. Two ship today:

| Workflow | Description |
|---|---|
| `code-review` | Multi-agent PR review: `prepareDiff → filterDiff → [security ‖ performance ‖ ux?] → judge`. |
| `your-review` | Open-ended sandbox for the hands-on finale (see [docs/04](../../docs/04-author-a-task.md)). |

## Run locally

```sh
npm install                        # from the repo root

# In-process: workflows run as direct function calls (RENDER_USE_LOCAL_DEV)
npm run dev --workspace @workshop/workflow-agents          # http://localhost:3000

# Full fidelity: each task in its own container, real retries/fan-out
npm run dev:workflows --workspace @workshop/workflow-agents
```

No API key required — agents fall back to a deterministic mock model. Set
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for real reviews, then trigger one:

```sh
curl -s -X POST http://localhost:3000/api/reviews \
  -H 'content-type: application/json' -d '{"prUrl":"https://github.com/<owner>/<repo>/pull/<n>"}'
```

Open `http://localhost:3000/` for the reviews table.

## Deploy

Deploy the Blueprint ([`render.yaml`](render.yaml)) — a Web Service + managed
Postgres — then create the Workflow service in the Render Dashboard (see
[docs/03](../../docs/03-workflow-agents.md)). In production,
`RENDER_USE_LOCAL_DEV=false` makes the gateway dispatch real Workflow tasks.

## Reference

**Layout**

```
src/
  server.ts          gateway entry (Hono web host)
  workflow.ts        workflow service entry (task registration only)
  github.ts          GitHub webhook verify + match
  workflows/
    loader.ts        workflow auto-discovery
    code-review/     the multi-agent review workflow
    your-review/     open-ended sandbox for the finale
```

**Routes**

| Route | Description |
|---|---|
| `POST /api/reviews` | Submit a code review by `{ prUrl }` |
| `GET /` · `/api/reviews` · `/api/reviews/:id` | Telemetry viewer + read APIs |
| `POST /webhooks/github` | GitHub PR webhook → code review |
| `GET /healthz` | Liveness check |

**Environment**

| Variable | Description |
|---|---|
| `RENDER_USE_LOCAL_DEV` | `true` runs tasks in-process (local dev) |
| `DATABASE_URL` | Postgres for durable runs; falls back to in-memory |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Optional; mock model if absent |
| `WORKFLOW_API_KEY` | Bearer token protecting `POST /api/reviews` (open when unset) |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for webhook verification |
| `GITHUB_TOKEN` | Raises GitHub rate limits / enables private-repo diffs |
| `RENDER_API_KEY` | Required in production for Workflow dispatch |

**Scripts**

| Script | Description |
|---|---|
| `npm run dev` | Gateway on port 3000 (in-process tasks) |
| `npm run dev:workflows` | Local Render task server + gateway |
| `npm run start` | Production start (gateway) |
| `npm run start:workflow` | Production start (workflow service) |
| `npm run typecheck` | TypeScript check |
