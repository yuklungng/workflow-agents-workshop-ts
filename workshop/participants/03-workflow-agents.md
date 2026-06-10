# 03 — Workflow agents (Render Workflows)

> **Session 2 — Module 3 (~20 min).** Welcome back from break. Everything you
> hand-rolled in Lab 1 — the queue, the acks, the retries — is about to become
> a config object. This pattern builds to the hands-on finale,
> [04 — Author a task](04-author-a-task.md).

> The same fan-out, expressed as Render tasks. The queue, retries, coordination,
> and observability you hand-rolled in worker-agents are now declarative — and the
> unit you author is just a **task**: a plain async function + a config object.

Lives in [`packages/workflow-agents`](../../packages/workflow-agents).

## The shape

```
trigger (PR URL or GitHub webhook) ─▶ code-review task
                                        prepareDiff()                  ← plain fn, in-process
                                        Promise.all([
                                          security.run(),              ← each agent is its own task()
                                          performance.run(),
                                        ])
                                        judge.run()
```

Everything is built on one primitive: `task()` from `@renderinc/sdk/workflows`.
Each agent runs in its **own isolated container** with per-task retries, timeouts,
compute size, and traces — none of which you wrote.

## Side-by-side: how fan-out is implemented

| | Code | You maintain |
| --- | --- | --- |
| naive-agent | `Promise.all([...])` in one process | nothing (but no scale/durability) |
| worker-agents | `XADD` jobs → consumer group → acks → pub/sub | the whole queue + coordination |
| workflow-agents | `Promise.all([agent.run(), ...])` where `agent` is a `task()` | nothing — Render does it |

## Create it with the CLI

This pattern uses a hybrid Render creation flow. The web service and Postgres
database still come from a Blueprint. Workflows don't support Blueprint creation
yet, so you'll create the Workflow service with the Render CLI.

Create three Render resources for this pattern:

- A Postgres database for telemetry
- A Web Service for the gateway and UI
- A Workflow service for the tasks

First confirm the CLI is logged in:

```sh
render whoami
render workspace set
```

Deploy the web service and Postgres database from this Blueprint:

```text
packages/workflow-agents/render.yaml
```

The Blueprint creates the web service, creates the database, wires
`DATABASE_URL`, and prompts for `RENDER_API_KEY`. Create a Render API key from
**Account Settings > API Keys** and use it for that prompt. The web service uses
the key to trigger Workflow task runs through the Render SDK.

After the Blueprint sync finishes, open the database's connection details and copy
the internal connection string. You'll pass it to the Workflow service so task
runs write spans to the same telemetry database.

Create the Workflow service with the CLI. This is a separate Render resource, so
it does not inherit build commands, start commands, or env vars from the Blueprint:

```sh
render workflows create \
  --name workflow-agents \
  --repo <your-repo-url> \
  --branch <your-branch> \
  --root-directory packages/workflow-agents \
  --runtime node \
  --build-command "cd ../.. && npm ci" \
  --run-command "cd ../.. && npm run start:workflow --workspace @workshop/workflow-agents" \
  --env-var DATABASE_URL=<internal-postgres-connection-string> \
  --env-var NODE_ENV=production \
  --output json \
  --confirm
```

If you're using real model output or private GitHub PRs, add
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GITHUB_TOKEN` to the Workflow service
with additional `--env-var` flags.

If you create the Workflow service in the Dashboard, use the same values:

| Field | Value |
| --- | --- |
| Root Directory | `packages/workflow-agents` |
| Build Command | `cd ../.. && npm ci` |
| Start Command | `cd ../.. && npm run start:workflow --workspace @workshop/workflow-agents` |

The root directory keeps auto-deploys scoped to the Workflow package. The commands
hop back to the monorepo root so npm can read the root `package-lock.json` and
install workspace dependencies.

## Trigger a live task

After the Workflow deploys, list registered tasks:

```sh
render workflows list
render workflows tasks list
```

Start the built-in `code-review` task:

```sh
render workflows start workflow-agents/code-review \
  --input='[{"url":"https://github.com/<owner>/<repo>/pull/<n>","labels":[]}]'
```

Open the task run in the Dashboard and inspect the trace. You should see the
reviewer tasks fan out and the judge task consolidate the result.

## Run it locally as a fallback

Render Workflows also run under the local dev runtime:

```sh
cd packages/workflow-agents
npm install

# terminal A — start the workflow dev runtime + host
npm run dev:workflows

# terminal B — list and trigger tasks
render workflows tasks list --local
render workflows start code-review --local \
  --input='[{"url":"https://github.com/<owner>/<repo>/pull/<n>","labels":[]}]'
```

## Trigger from a public repo (dummy inbound)

The GitHub webhook adapter
([`src/github.ts`](../../packages/workflow-agents/src/github.ts))
maps `pull_request` events onto the `code-review` task. Point a public repo's
webhook (or a manual "Trigger Run") at the deployed service to review real PRs.

## What Render gives you here

- **Workflows** — durable, on-demand tasks with managed queuing, retries/backoff,
  per-task compute, parallel fan-out, and full traces in the dashboard.
- CLI creation and `git push` deploys. There is no separate worker or queue to
  operate.

## Same agents as naive-agent and worker-agents

This package consumes `@workshop/agent` directly — the **same** `REVIEWERS` and
`judge` the naive and worker patterns run. Each agent is wrapped in a `task()`
call directly in
[`code-review/index.ts`](../../packages/workflow-agents/src/workflows/code-review/index.ts) —
no wrapper file, no factory:

```ts
const securityTask = task(
  { name: "security", timeoutSeconds: 120, retry: { maxRetries: 2 } },
  async (input, runId?) => securityReviewer.run(input, { tracer: storeTracer(), runId }),
);
```

`agent.run()` is identical everywhere. Wrapping it in `task()` is what buys
per-agent isolation, retries, and traces. The agents are the plain `defineAgent`
objects from the shared package, and workflows are auto-discovered by
`loader.ts` — no manual registration.

Tools and MCP also come from the shared registry, so adding a tool or an MCP
server (`defineMcpSource`) makes it available to all three patterns at once.

## Now author your own

The agents are a library you *use*. The thing you *write* is tasks. Head to
[04 — Author a task](04-author-a-task.md) and build the `your-review` workflow:
a task with retry/timeout config, a deterministic step, and an agent composed as
its own task — all auto-discovered. That doc also has **bonus points** (a judge
reflection loop, an MCP tool, and a human-in-the-loop gate), and
[05 — Future iterations](05-future-iterations.md) maps the road to production.