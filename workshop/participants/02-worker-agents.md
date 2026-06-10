# 02 — Worker agents (queue + background worker)

> **Session 1 — Module 2 (~20 min) + Lab 1 (~20 min).** This pattern adds
> durability and scale, but you pay for it with coordination code. The exercise
> at the end is hands-on — do it by hand, no coding agents yet. That setup is
> what makes Pattern 3 land. A break follows Lab 1.

> Same agent, different substrate. The web tier becomes a thin producer. A
> Background Worker consumes a Valkey queue and runs the review out-of-band.

## The shape

```
browser ─POST /api/reviews─▶ web (producer)
                               create review → XADD job to Valkey → return 202
Valkey stream ─▶ worker (consumer)        [scale: run N workers]
                  runReview()             ← byte-for-byte identical to naive-agent
                  publish progress ─pub/sub─▶ web ─SSE─▶ browser
                  write telemetry → Postgres
```

- Producer: [`packages/worker-agents/src/web.ts`](../../packages/worker-agents/src/web.ts)
- Consumer: [`packages/worker-agents/src/worker.ts`](../../packages/worker-agents/src/worker.ts)
- Queue + pub/sub: [`worker-agents/src/kv.ts`](../../packages/worker-agents/src/kv.ts)

The agent code did not change. Only *where it runs* did.

## Deploy the worker pattern

Deploy Pattern 2 from its Blueprint:

```text
packages/worker-agents/render.yaml
```

Render creates:

- A Web Service that enqueues jobs and serves the UI
- A Background Worker that consumes jobs
- A Key Value instance for the stream and progress pub/sub
- A Postgres database for telemetry

Open the Web Service URL, submit several PRs quickly, and watch the worker service
logs. The web tier returns quickly because the review runs out-of-band.

Use the CLI for inspection:

```sh
render services
render logs --resources <worker-service-id> --tail
render logs --resources <web-service-id> --tail
```

Scale the Background Worker from the Dashboard, or update `numInstances` in the
Blueprint and sync it. Throughput rises without changing the agent code.

## Exercise: write the ack semantics

Before you run it, you implement the one piece that *is* the worker pattern.
Open [`worker-agents/src/kv.ts`](../../packages/worker-agents/src/kv.ts) and find
`processEntry` — it currently throws. Your job: handle one delivered stream
entry and decide whether to acknowledge it.

The rule:

- **Success** → `XACK` the message so the group never redelivers it.
- **Failure** (handler throws) → **don't** ack. Log and return so the message
  stays pending and gets retried. Don't let the error escape the loop.

Verify with a local Valkey/Redis running:

```sh
REDIS_URL=redis://127.0.0.1:6379 npm run test:worker
```

Two tests go from red to green: one asserts a handled message is acked (leaves
the pending list), the other asserts a failed handler leaves it pending.

> Do this one by hand — it's a few lines, and feeling the acks/retries you own is
> the whole point. You'll bring out coding agents in Session 2.

After the tests pass, commit or push your change and redeploy the worker. This is
the Pattern 2 lesson in one loop: the platform runs the worker, but your code owns
the queue semantics.

## Run it locally as a fallback

```sh
npm run worker:web         # terminal A — http://localhost:3000
npm run worker:worker      # terminal B — one worker
npm run worker:worker      # terminal C — another worker (scale out)
```

Try these demos:

1. **Concurrency** — submit several PRs quickly and watch workers share the load.
2. **Scale-out** — start more workers. Throughput rises with no code change.
3. **Resilience** — kill the web service mid-review. The worker finishes and the
   result is still in Postgres when web restarts.

## What Render adds

- **Background Worker** — a service with no public port that runs your consumer.
  Scale it independently (`numInstances`).
- **Valkey** — managed Redis-compatible store. Here it's both the work queue
  (stream + consumer group) and the live progress bus (pub/sub).

## What you had to build yourself

Look at [`worker-agents/src/kv.ts`](../../packages/worker-agents/src/kv.ts): the stream, the consumer group,
blocking reads, acks, retry-on-failure (un-acked messages), and the pub/sub
progress channel. It's all coordination code *you* now own and
debug.

Next: [03 — Workflow agents](03-workflow-agents.md).
