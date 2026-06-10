# 01 — Naive agent (in-process)

> **Session 1 — Module 1 (~15 min).** Deploy the simplest version, see it work,
> then understand where it breaks. This sets up the motivation for Pattern 2.

> The agent runs inside the web request. Simple, complete, and the baseline we
> spend the rest of the workshop improving.

## The shape

```
browser ──POST /api/reviews──▶ web service (single process)
                                  runReview():
                                    prepareDiff(prUrl)
                                    Promise.all([ security, performance ])   ← fan-out, in-process
                                    judge(findings)
                                  persist telemetry → Postgres
                                  respond when done
```

The whole pipeline lives in [`packages/naive-agent/src/server.ts`](../../packages/naive-agent/src/server.ts).
Notice the handler `await`s `runReview()` and only then responds.

## Deploy it first

Deploy Pattern 1 from its Blueprint:

```text
packages/naive-agent/render.yaml
```

In the Render Dashboard, create a new Blueprint from your forked repo and point it
at that file. Render creates:

- A Web Service for the Hono app
- A Postgres database for telemetry
- Optional secret slots for provider keys and `GITHUB_TOKEN`

When the deploy finishes, open the Web Service URL and paste a public PR URL. The
table shows the run. Click a row to see reviewer findings and agent spans.

This is the first success moment: the code reviewer is live on Render.

## Inspect the live service

Use the Dashboard or CLI to inspect what happened:

```sh
render services
render logs --resources <naive-service-id> --tail
```

The important detail is still in the code: the POST handler waits for the full
agent run before it responds.

## Run it locally as a fallback

```sh
npm run naive:dev          # http://localhost:3000
```

Local mode is useful if a learner needs to debug code without waiting for a deploy.

## What Render gives you

- **Web Service** — your HTTP server, deployed from `git push`.
- **Postgres** — the durable telemetry record the UI reads.
- One Blueprint (`render.yaml`) wires both together.

## Where it breaks (motivation for worker-agents)

- The review runs **inside the request**. A large PR or a slow model can blow past
  HTTP/proxy timeouts.
- A deploy or crash **kills in-flight reviews** — there's nowhere durable for the
  work to live.
- Concurrent users **share one process**. The "parallel" reviewers still compete
  for the same box.
- You can't scale the agent **independently** of the web tier.

The live app makes these trade-offs concrete: it is deployed, observable, and
complete, but the agent work is still coupled to one HTTP request.

Next: [02 — Worker agents](02-worker-agents.md).
