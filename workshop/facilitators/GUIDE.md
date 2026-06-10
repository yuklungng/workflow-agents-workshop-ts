# Facilitator Guide — Building Production-Ready Agents on Render Workflows

Everything you need to teach this workshop. Read this once end-to-end before you
run it the first time, then keep the **Run sheet** and **Solutions** sections
open on a second screen while you present.

The companion learner-facing material is in [`../participants`](../participants) (`00`–`05`). This
guide is the teaching layer *on top* of those docs: objectives, timing, talk
tracks, demos, the "aha" moments, common failure modes, and the worked solutions.

---

## 1. What this workshop is

**Summary:** Attendees explore practical architectural patterns for building and
deploying scalable, production-grade agents. They leave with a deployable
Workflow for multi-agent code reviews.

**One key takeaway:** it's easy to ship scalable, reliable agent workloads when
the platform handles orchestration and you focus on the logic.

**Supporting takeaways:**

- Managed data primitives (Postgres, Valkey) provide what modern apps need with
  minimal wiring.
- Workflows are a powerful and ergonomic primitive for running and orchestrating
  agents.
- Choosing the right platform means less time spent on infrastructure, and more time spent on the agent layer.

### The system being built

Every pattern implements the same end-to-end flow:

```
1. Receive a GitHub PR (URL or webhook)
2. Fan out specialist reviewers (security, performance, ux)
3. A judge consolidates findings into approve / request-changes
4. The verdict is posted (or returned as telemetry)
```

Learners deploy this pipeline three ways and *feel* the trade-offs:

| # | Pattern | Primitives | The lesson |
| --- | --- | --- | --- |
| 1 | `naive-agent` | Web Service + Postgres | Simplest possible thing — and exactly where it breaks |
| 2 | `worker-agents` | + Background Worker + Valkey (stream + pub/sub) | Durability is real, but **you** hand-roll the coordination |
| 3 | `workflow-agents` | + Workflows (retries, timeouts, per-task compute, traces) | The same guarantees become a config object |

Each pattern isolates exactly one new idea instead of drowning it in application
logic. The agent code stays constant so the infrastructure stays at the center of
every segment.

The pipeline (`prepareDiff → filterDiff → [security ‖ performance ‖ ux?] → judge`)
lives in the shared [`@workshop/agent`](../../shared/agent) package and is 
identical across all three. 

### Learning objectives

By the end, a learner can:

1. Deploy a multi-service app from a Blueprint and understand the shared agent
   loop driving the code-review pipeline.
2. Explain the failure modes of running agent work inside an HTTP request
   (blocking, lost on redeploy, no independent scale).
3. Describe what a queue + worker buys you (durability, scale-out, retries) and
   what it *costs* you (acks, consumer groups, pub/sub — code you own and debug).
4. Hand-write at-least-once delivery semantics (ack on success, retry on failure).
5. Author and ship a Workflow `task()` — a plain async function + a config
   object — and get retries, isolation, timeouts, and traces for free.
6. Compose agents as tasks, fan them out with `Promise.all`, and articulate *why*
   the same guarantees took a whole queue in Pattern 2 and a config object in
   Pattern 3.

### Who it's for

Backend / full-stack engineers comfortable with TypeScript and async/await.
No prior queue or agent-framework experience required. Familiarity with HTTP and
a mental model of "a process handling requests" is enough.

---

## 2. Logistics

- **Total time:** ~1.5 hours, designed as **two sessions** with a break.
  - **Session 1 — Substrates & coordination** (~50 min): Patterns 1 & 2,
    including the hand-rolled ack exercise.
  - **Session 2 — Let the platform (and agents) do it** (~50 min): Pattern 3
    and the author-a-task finale, where coding agents come out.
- **Format:** live deploys + two hands-on labs. Learners follow along on their own
  Render accounts and machines.
- **Group size:** works 1:1 up to ~30 with a helper for debugging environments.
- **Delivery:** in-person or remote. Remote works fine. Have learners share service
  URLs, CLI output, and Dashboard screenshots when they get stuck.

### Compressed variants

**60-minute (conference slot).** Cut Module 2 to a 5-minute narrated scroll of
`kv.ts` (no deploy), skip Lab 1 entirely, and tell learners it's in the docs for
later. Open Session 2 by *showing* the Lab 1 solution and naming the aha
("at-least-once delivery — you'd have written all of that"). This preserves the
emotional arc while giving Lab 2 the full 25 minutes it needs. Drop the close to
5 minutes.

| Module | Full (90 min) | 60-min | What changes |
| --- | --- | --- | --- |
| Setup & framing | 10 min | 8 min | Shorter spine — draw, don't narrate |
| Pattern 1 | 15 min | 10 min | Deploy live, break it on stage, move on |
| Pattern 2 | 20 min | 5 min | Narrate `kv.ts` only — no deploy |
| Lab 1 | 20 min | 0 min | Cut — show the solution instead |
| Break | 5–10 min | 0 min | No break |
| Pattern 3 | 20 min | 12 min | Deploy + trace, skip Dashboard walkthrough |
| Lab 2 | 30 min | 20 min | Steps 1–3 only; skip ship-live |
| Close | 10 min | 5 min | Spine re-draw + one exit question |

**45-minute (lightning).** Demo only — no hands-on labs. Walk Pattern 1 → break
it → show `kv.ts` as the price → deploy Pattern 3 → run `code-review` → show
the trace → close on the spine. Learners follow the participant walkthrough and labs
on their own afterward using `workshop/participants/`. Good for a lunch talk or
conference keynote lead-in.

**3-hour (deep dive).** Run the full 90-minute version, then extend Session 2
with all three bonus points from
[04 — Bonus points](../participants/04-author-a-task.md#bonus-points): the judge
reflection loop, the MCP tool, and the HITL gate. Give each bonus 20–25 minutes.
Add a second break between Lab 2 and the bonus round. Close with a group
discussion on which bonus pattern is most relevant to their team's stack.

---

## 3. The spine (the one mental model to land)

Draw this once, early, and return to it at every transition. It is the whole talk.

```
            SAME AGENT  ───────────────────────────────────▶  (never changes)

Pattern 1   [ web request runs the agent ]                 you own: nothing
            └ breaks: timeouts, lost on deploy, no scale       scales: no

Pattern 2   [ web ] → (Valkey queue) → [ worker runs agent ] you own: queue,
            └ durable, scales by adding workers                consumer group,
                                                               acks, retries, pub/sub

Pattern 3   [ web ] → Render Workflows → [ task per agent ]  you own: nothing
            └ same durability + scale, declarative             scales: yes
```

The emotional arc you're selling:

1. **Pattern 1 feels good** ("look, it's live") → then you break it on stage.
2. **Pattern 2 is powerful** ("now it's durable and scales!") → then they write
   the acks by hand and see how much coordination they now *own*.
3. **Pattern 3 feels like cheating** ("wait, that's it?") → the guarantees from
   Pattern 2 collapse into `retry: { maxRetries: 2 }`, a CLI-created Workflow, and
   a trace.

If learners leave able to recite "the agent never changed, the substrate did the
work," the workshop succeeded.

### Why the arc works (read this once, then internalize)

These are the design principles behind the session order. You don't need to say
any of this on stage — they're here so you understand *why* the structure works,
which helps you adapt when things go sideways.

- **Foundation first, new primitive last.** The arc builds in the order the
  platform story should be told: a web service and managed Postgres, then a
  background worker and Valkey, then Workflows. By the time attendees reach
  Workflows, they're standing on infrastructure they already trust — so the new
  primitive reads as the natural next step, not a leap.
- **The payoff is earned, not asserted.** In Session 1 attendees hand-roll the
  queue, acks, retries, and coordination a worker needs. In Session 2 they watch
  Workflows make all of it disappear. The value of the platform is felt through
  the contrast, not through a pitch.
- **Minutes from fork to running agent.** Managed data services provisioned from
  a Blueprint and a mock-model fallback that needs no API keys mean the first
  real win (a live deploy reviewing a PR) lands early. Checkpoints at each stage
  mean no one gets stranded.
- **They leave having built and shipped, not just watched.** Every attendee
  deploys a real multi-service app and authors a real task. They walk out with a
  deployable Workflow and a fork they can keep extending — not a slide deck to
  forget.
- **Reliable on stage and on conference wifi.** The pipeline is deterministic
  and self-contained: a public PR as input, a mock model that needs no external
  API calls, and no dependence on per-attendee secrets. What's shown on stage is
  what attendees can reproduce in the room, every time.

---

## 4. Pre-flight checklist

Do this **before** learners arrive (and have learners do the install ahead of time
if you can — environment setup is the #1 time sink).

Facilitator machine:

- [ ] Node >= 22.12 (`node -v`).
- [ ] `npm install` from the repo root completes clean.
- [ ] Render CLI installed, logged in, and pointed at the right workspace
      (`render login`, then `render workspace set`).
- [ ] A fork or workshop repo connected to Render.
- [ ] Pattern 1 and Pattern 2 Blueprints tested from that repo.
- [ ] Pattern 3 hybrid path rehearsed with the web+Postgres Blueprint and
      `render workflows create`.
- [ ] Optional local Postgres running with `createdb agents_workshop`.
- [ ] Optional local Redis/Valkey running with `redis-server &` or
      `docker run -p 6379:6379 redis`.
- [ ] `npm test` is green (this proves the whole thing works on the mock model).
- [ ] A couple of **demo PR URLs** picked out — one small, one with frontend files
      so the `ux` reviewer fires. Public repos need no token. e.g.
      `https://github.com/octocat/Hello-World/pull/9681`.
- [ ] Decide: real model or mock? With **no LLM provider API key** everything runs
      on a deterministic mock model — totally fine and fully offline. Set
      `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` only if you want live reviews. Have
      `AGENT_MODEL=mock` ready as a fallback if the gateway misbehaves on stage.

Room / screen:

- [ ] Terminal font large enough to read from the back.
- [ ] Browser tabs open to the Render Dashboard, the learner-facing docs, and one
      deployed service URL.
- [ ] Terminal tabs ready for `render services`, `render logs`, and
      `render workflows`.

Tell learners up front: **no LLM provider API key is required.** This removes the
single biggest source of "it doesn't work for me."

### Stage reliability

The workshop is designed to be deterministic and self-contained on conference
wifi. Keep these safety nets in mind:

- **Mock model is the default.** With no API key set, every deploy and test
  runs on a deterministic mock — totally offline, totally reproducible. Use real
  model output only when you specifically want live review text and have tested
  the connection.
- **Public PRs as input.** Demo PRs are from public repos and need no token.
  GitHub's unauthenticated rate limit is generous enough for a room of 30.
- **Pre-deployed reference instance.** If a learner's deploy stalls, they can
  point at your pre-deployed service URL to see the full pipeline in action
  while they debug. Deploy all three patterns from your facilitator fork before
  the session and keep the URLs bookmarked.
- **`AGENT_MODEL=mock` as escape hatch.** If a live model misbehaves mid-demo,
  switch to `AGENT_MODEL=mock` and keep moving. The pipeline is identical
  either way — the mock just returns deterministic output.

### Setup triage (first 10 minutes)

Common setup failures and how to unblock attendees fast:

| Symptom | Fix | Time |
| --- | --- | --- |
| No fork yet | Fork now; run the setup-attendee Action while `npm install` runs | 2 min |
| `npm install` fails | Check Node version (`node -v` — need >= 22.12). If wrong version, `nvm install 22` | 2 min |
| Render CLI not installed | `brew install render` (macOS) or `npm install -g @render-oss/cli` | 1 min |
| Can't connect Git provider in Render | Pair with a neighbor who has it working; they follow along on the neighbor's deploy until break, then sort it out | 0 min (defer) |
| Blueprint names collide on Render | They didn't run `setup-attendee.yml`. Run `npm run setup` locally, commit, and push | 1 min |
| Windows/Linux path issues | Rare. Docker path (`npm run docker:up`) sidesteps most of these | 3 min |

**Rule of thumb:** if an attendee isn't unblocked within 3 minutes, pair them
with a neighbor and circle back at the break. Never let one setup issue stall the
whole room.

---

## 5. Run sheet (module by module)

Each module below has: **objective**, **talk track**, **do this live**, **the aha**,
**pitfalls**, and a **check for understanding (CFU)**.

### Module 0 — Setup & framing (10 min)

- **Objective:** everyone can deploy, and everyone understands the spine.
- **Talk track:** "We're going to build a code reviewer once and run it three ways.
  Watch what *doesn't* change." Draw the spine.
- **Do this live:** confirm `render login`, `render workspace set`, and
  `npm install`. Point out the monorepo: `shared/*` is the constant, `packages/*`
  are the three patterns.
- **Pitfall:** learners without Git provider access in Render. Pair them with a
  helper or have them follow the facilitator deploy while they keep coding locally.
- **CFU:** "Which folder holds the agent itself?" (Answer: `shared/agent`, not any of the three packages.)

Reference: [`00-setup.md`](../participants/00-setup.md).

### Module 1 — Pattern 1: the naive baseline (15 min)

- **Objective:** deploy a multi-service app from a Blueprint, understand the
  shared agent loop and code-review agents, run the agent in-process against a
  real public PR, inspect the results — then make its breakage visceral.
- **Talk track:** "Simplest thing that works: the agent runs *inside the request*."
- **Do this live:**
  1. Deploy [`packages/naive-agent/render.yaml`](../../packages/naive-agent/render.yaml)
     as a Blueprint.
  2. Open the live Web Service URL and submit a demo PR.
  3. Open the row → show per-agent findings and spans (LLM turns + tool calls).
  4. Tail logs with `render logs --resources <service-id> --tail`.
  5. Show the handler in [`packages/naive-agent/src/server.ts`](../../packages/naive-agent/src/server.ts):
     the POST handler `await`s `runReview()` and *only then* responds. Read the
     file's top comment aloud — it names the three failure modes.
- **The aha:** it's complete and simple. Sit in that for a second before breaking it.
- **Break it on stage (the motivation for Pattern 2):**
  - Submit a large PR (or talk through it) → the request blocks. A slow model or a
    proxy timeout kills it.
  - "What happens if I redeploy mid-review?" → in-flight work is lost. Nowhere
    durable for it to live.
  - Concurrent users share one process. The "parallel" reviewers contend for one box.
- **Pitfall:** if using a real model, a big PR can genuinely time out. That's the
  point, but don't let it derail. Switch to a small PR to keep moving.
- **CFU:** "Name two reasons this design fails under load." (timeouts, lost on
  deploy/crash, no independent scale.)

Reference: [`01-naive-agent.md`](../participants/01-naive-agent.md).

### Module 2 — Pattern 2: worker + queue (20 min, before the lab)

- **Objective:** decompose the in-process agent into a queue + background worker.
  Scale out by adding workers and show the system survives a web redeploy and
  runs reviews concurrently. Then name the cost: you own the queue, consumer
  group, acks, retries, and progress plumbing. This sets up Workflows as the
  relief in Session 2.
- **Talk track:** "Same `runReview()`. The web tier becomes a thin producer. A
  background worker consumes a Valkey queue and runs the review out-of-band."
- **Do this live:**
  1. Deploy [`packages/worker-agents/render.yaml`](../../packages/worker-agents/render.yaml)
     as a Blueprint.
  2. Submit several PRs quickly → watch the web service enqueue and return 202.
  3. Tail the worker logs with `render logs --resources <worker-id> --tail`.
  4. Scale the Background Worker in the Dashboard or update `numInstances`.
  5. Restart or redeploy the web service mid-review → the worker keeps owning the job.
- **The aha:** the agent code is *identical to Pattern 1* — point at the comment in
  `kv.ts` that says `runReview()` is unchanged. Only *where it runs* moved.
- **Now flip it:** open [`packages/worker-agents/src/kv.ts`](../../packages/worker-agents/src/kv.ts)
  and scroll the file slowly. "This is the price. The stream, the consumer group,
  blocking reads, acks, retry-on-failure, the pub/sub progress bus — all of this is
  coordination code *you* now own and debug." This sets up the lab.
- **Pitfall:** Blueprint sync or service deploy still running → the web app can open
  before the worker is ready. Check service health and worker logs first.
- **CFU:** "What did we have to add going from Pattern 1 to Pattern 2, and what did
  we change in the agent?" (Added: queue/worker/acks/pub-sub. Changed in agent:
  nothing.)

Reference: [`02-worker-agents.md`](../participants/02-worker-agents.md).

### LAB 1 — Hand-write the ack semantics (20–25 min)

This is the Session 1 hands-on. It's deliberately small and done **by hand** (no
coding agents yet) — feeling the acks/retries you own is the entire point, and it
makes Pattern 3 land harder.

- **Setup:** learners open `processEntry` in
  [`packages/worker-agents/src/kv.ts`](../../packages/worker-agents/src/kv.ts). It
  currently throws. The exercise contract is in the comment block right above it.
- **The task:** handle one delivered stream entry and decide whether to ack.
  - **Success** → `XACK` so the group never redelivers it.
  - **Failure** (handler throws) → **don't** ack. Log and return so the message
    stays pending and gets retried. **Never let the error escape the loop** (that
    would kill the consumer).
- **Verify (red → green):**
  ```sh
  REDIS_URL=redis://127.0.0.1:6379 npm run test:worker
  ```
  Two tests flip: one asserts a handled message is acked (leaves the pending list),
  one asserts a failed handler leaves it pending.
- **Facilitation:**
  - Give them ~8–10 min before showing anything. Circulate.
  - Hint ladder (escalate only as needed):
    1. "Parse first: `const job = fieldsToJob(fields)`."
    2. "Wrap the work + the ack in one try/catch."
    3. "In the catch, log and `return` — do not rethrow, do not ack."
  - The single most common bug: acking in a `finally`, or letting the error
    propagate. Both defeat the retry. Call this out explicitly.
- **The aha to name out loud:** "You just implemented at-least-once delivery. Hold
  onto this feeling — in Session 2 you get the exact same guarantee for free."
- **Deploy beat:** push the fix and redeploy the worker. The lab is local because it
  is a tight red-to-green loop, but the result runs live.
- **Solution:** see §8 and [`02-worker-agents.md`](../participants/02-worker-agents.md).

> Break here between sessions.

### Module 3 — Pattern 3: Workflows (20 min)

- **Objective:** explain what Workflows replace (queue, acks, retries, backoff,
  observability). Compose and fan out tasks — call one task from another and
  parallelize reviewers with `Promise.all`. Trace a multi-agent run: per-agent
  isolation, retries, timeouts, and parallel fan-out visible in the trace view.
- **Talk track:** "Same fan-out, expressed as Render tasks. The queue, retries,
  coordination, and observability you hand-rolled are now declarative. The unit you
  author is a **task**: a plain async function + a config object."
- **Do this live:**
  ```sh
  # deploy packages/workflow-agents/render.yaml first
  render workflows create ...     # Workflow service
  render workflows tasks list
  render workflows start workflow-agents/code-review \
    --input='[{"url":"https://github.com/<owner>/<repo>/pull/<n>","labels":[]}]'
  ```
  Use [`03-workflow-agents.md`](../participants/03-workflow-agents.md) for the full
  command block. Call out the required env-var step plainly: the web service and
  Workflow service need the same Postgres connection string.
  If using the Dashboard form, set Root Directory to `packages/workflow-agents`,
  Build Command to `cd ../.. && npm ci`, and Start Command to
  `cd ../.. && npm run start:workflow --workspace @workshop/workflow-agents`.
- **Show the code that matters:**
  - [`code-review/index.ts`](../../packages/workflow-agents/src/workflows/code-review/index.ts):
    each reviewer is a direct `task()` call wrapping `agent.run()` — no wrapper
    file, no factory. `prepareDiff`/`filterDiff` are plain in-process functions.
    `Promise.all` fans out the reviewer tasks. `ux` is conditional on frontend files.
- **The aha:** put the three "fan-out" implementations side by side (this table is
  the punchline of the whole workshop):

  | Pattern | How fan-out is written | You maintain |
  | --- | --- | --- |
  | naive | `Promise.all([...])` in one process | nothing, but no scale/durability |
  | worker | `XADD` → consumer group → acks → pub/sub | the whole queue (Lab 1!) |
  | workflow | `Promise.all([agent.run(), ...])` where `agent` is a `task()` | nothing |

- **Pitfall:** if a live task list is empty, the Workflow version might not be
  released yet, or the workflow didn't auto-discover. It must be
  `src/workflows/<name>/index.ts` exporting a `task()`.
- **Pitfall:** if the Workflow service can't find `tsx` or workspace packages, the
  root directory/commands are wrong. The Workflow root should be
  `packages/workflow-agents`, and both build/start commands should `cd ../..`
  before running npm.
- **CFU:** "Where are the retries in Pattern 3?" (In the task's config object —
  compare to the hand-written retry you wrote in Lab 1.)

Reference: [`03-workflow-agents.md`](../participants/03-workflow-agents.md).

### LAB 2 — Author a task (25–35 min, the finale)

This is the highest-value segment. **Now coding agents come out.** Learners
grasp the task model (a config object + an async function; composition is just
function calls; fan-out is just `Promise.all`), author a task and run it locally
with auto-discovery, compose an agent into a task, force a failure and watch
retries happen with no try/catch or queue, and ship it — the same task graph
deploys live.

- **Starter:** [`your-review/index.ts`](../../packages/workflow-agents/src/workflows/your-review/index.ts)
  is already a working sandbox. It auto-discovered with zero registration.
- **Sequence (each step has a payoff):**
  1. **Preview what's there.** `render workflows tasks list --local` → `your-review`
     → run with `{ "url": "...pull/<n>" }`. Payoff: "you authored a task and never
     registered it anywhere — `loader.ts` found it because the folder exists."
  2. **Compose an agent as a task.** Extend the sandbox to run a reviewer as its own
     task and return its findings. Encourage learners to point their coding agent
     (Cursor/Claude/etc.) at the ideas at the bottom of the file.
  3. **See the power — force a retry.** Add `if (Math.random() < 0.5) throw new
     Error("flaky!")` at the top of the body. Re-run a few times and watch Render retry
     in a fresh instance per the `retry` config — no try/catch, no dead-letter, no
     queue. **Remove it when done.**
  4. **Bonus — fan out** both reviewers with `Promise.all` (mirrors `code-review`).
  5. **Ship it live.** Push the task, release a Workflow version, start the live
     `your-review` task, and open the trace in the Dashboard.
- **Facilitation & pacing:**
  - Give them ~5 min on step 1 (preview). Most will finish fast. Use this as a
    buffer for stragglers still setting up Pattern 3.
  - Steps 2–3 are the core. Allocate ~12 min. Circulate actively — this is where
    learners diverge (some use coding agents, some type by hand).
  - At the **15-minute mark**, do a room check: "Who has a nested task running?"
    If fewer than half, pause and walk through step 2 live.
  - At the **20-minute mark**, announce: "5 minutes left for the core steps. If
    you're on step 3, great — remove the `throw` and move to step 4 or 5. If
    you're still on step 2, that's fine — the solution is in the guide."
  - Steps 4–5 are stretch goals. Don't wait for the room to finish them.
  - Hint ladder (escalate only as needed):
    1. "Start with a single reviewer: `import { securityReviewer } from '@workshop/agent'`."
    2. "Wrap it in `task()` directly: `const securityTask = task({ name: 'security' }, async (input) => securityReviewer.run(input, { tracer: storeTracer() }))`."
    3. "Call it inside your task body: `const review = await securityTask({ patches: filtered.patches })`."
    4. "For the retry step, throw *before* the reviewer call so the retry is
       visible in the trace."
    5. "For fan-out: one `task()` per reviewer, then `Promise.all`. Look at
       `code-review/index.ts` for the pattern."
  - Common bug: forgetting to import `task` from `@renderinc/sdk/workflows` or
    `storeTracer` from `@workshop/db`. Call out the two imports early.
  - **Coding agent tip:** tell learners their coding agent (Cursor, Claude, etc.)
    has access to Render-specific skills in `.agents/skills/` — the `render-workflows`
    skill is especially useful for `task()` patterns and local dev commands.
- **Early finishers:** point them at the bonus challenges in
  [04 — Bonus points](../participants/04-author-a-task.md#bonus-points):
  a **judge reflection loop**, **wiring in an MCP tool**, and a **human-in-the-loop
  gate**. Each reinforces the spine: the agentic capability is yours to write.
  Durability/isolation/tracing stay the platform's.
- **The aha (say this verbatim-ish):** "You just added durable, retried, isolated,
  traced, parallel execution by writing a plain function and a config object. In
  Lab 1 that same guarantee took a queue, a consumer group, acks, and a pub/sub bus
  — all code you owned. The agent never changed. The substrate did the work."
- **Pitfall:** learners need to import `task` from `@renderinc/sdk/workflows` and
  the agent from `@workshop/agent`. Both are workspace packages, so no extra install.
- **CFU:** "What's the difference between a *step* and a *task* here?" (A step is a
  plain function for pure logic. A task is wrapped in `task()` for isolation/retries/
  traces. See `overview()` vs the exported task in `your-review`.)
- **Solution:** §8 and [`04-author-a-task.md`](../participants/04-author-a-task.md).

### Module 4 — Close (10 min)

- **Name what they built and shipped.** Every attendee deployed a real multi-service
  app, hand-wrote queue semantics, and authored a real Workflow task. They have a
  running fork they can keep extending — this isn't a demo they watched, it's code
  they own.
- **Send them home with the map.** Point at [05 — Future iterations](../participants/05-future-iterations.md):
  an eval harness, guardrails, circuit breakers, and observability deep-dives — the
  production road, framed as "more steps, tasks, budgets, and tracers. Still the
  same agent."
- **The fork is the handoff.** Remind them: their fork has the full repo, all
  three patterns, the mock model, and the bonus challenges. The guided docs in
  `workshop/participants/` walk through everything they didn't finish. The mock
  model means they can keep going with zero credentials.

---

## 6. Clock-time run sheet (print this)

Adjust the start time to your slot. Everything else shifts. Modules marked with
a flex icon (~) can be shortened by the amount shown if you're running behind.
Modules marked with a lock icon (!) should never be cut — they carry the core
payoff.

**Example: 9:00 AM start, 90-minute slot**

| Clock | Dur | Module | Flex | Notes |
| --- | --- | --- | --- | --- |
| 9:00 AM | 10 min | **Module 0 — Setup & framing** | ~ can cut to 7 min | Draw the spine. Confirm `render login`. |
| 9:10 AM | 15 min | **Module 1 — Pattern 1** | ~ can cut to 10 min | Deploy, submit PR, show spans, break it on stage. |
| 9:25 AM | 10 min | **Module 2 — Pattern 2** | ~ can cut to 12 min | Deploy, tail worker logs, scale, open `kv.ts`. |
| 9:35 AM | 15 min | **Lab 1 — Hand-write acks** | ! never cut | The hands-on setup for the Pattern 3 payoff. |
| 9:50 AM | 10 min | **Break** | ~ can cut to 0 | Skip if running behind — but people need it. |
| 10:00 AM | 20 min | **Module 3 — Pattern 3** | ~ can cut to 12 min | Blueprint + CLI Workflow, run task, show trace, fan-out table. |
| 10:20 AM | 20 min | **Lab 2 — Author a task** | ! never cut below 20 min | The finale. Steps 1–3 minimum; 4–5 if time allows. |
| 10:40 AM | 10 min | **Module 4 — Close** | ~ can cut to 5 min | Re-draw spine, exit ticket, point at `05-future-iterations`. |
| 10:50 AM | — | **End** | | |

**If you're 10+ min behind at the break:** cut Module 3 to 12 min (skip the
Dashboard walkthrough — just show the CLI and the trace) and start Lab 2 with
"steps 1–3 only, ship-live is homework." Protect Lab 2's minimum 20 min — it's
the reason they came.

**Transition cues (say these at each boundary):**
- Setup → Pattern 1: "Now let's see the simplest version live."
- Pattern 1 → Pattern 2: "That broke. Let's fix durability — but watch what it costs."
- Pattern 2 → Lab 1: "Your turn. Implement the ack that makes this durable."
- Lab 1 → Break: "You just implemented at-least-once delivery. Hold that feeling."
- Break → Pattern 3: "Now watch all of that become a config object."
- Pattern 3 → Lab 2: "Your turn again — but this time, bring out your coding agents."
- Lab 2 → Close: "Let's zoom out. What changed in the agent? Nothing."

### The demo flow at a glance

```
Setup        render login → render workspace set → npm install → draw the spine
Pattern 1    Blueprint deploy → live URL → submit PR → show spans/logs → break it
Pattern 2    Blueprint deploy → submit PRs → tail worker logs → scale worker
             → open kv.ts: "this is the price"
LAB 1        implement processEntry → npm run test:worker (red→green)
── break ──
Pattern 3    Blueprint web+DB → workflows create → run code-review → show trace
             → side-by-side fan-out table
LAB 2        preview your-review → compose agent → force retry → ship live
Close        re-draw spine: "the agent never changed"
```

---

## 7. Troubleshooting & FAQ

| Symptom | Cause / fix |
| --- | --- |
| Reviews never run / agent output looks canned | No LLM provider API key → it's the **mock model**. Expected. Set `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` for real reviews. |
| Pattern 2 web errors on submit | Redis/Valkey not running, or `REDIS_URL` wrong. `redis-server &`. |
| `npm run test:worker` can't connect | Same — needs a live Redis. Prefix with `REDIS_URL=redis://127.0.0.1:6379`. |
| Postgres connection refused | `createdb agents_workshop` or fix `DATABASE_URL`. For Pattern 1 you can leave it unset (in-memory). |
| `render workflows tasks list --local` is empty | The `dev:workflows` process isn't running (terminal A), or the workflow folder isn't `src/workflows/<name>/index.ts` exporting a `task()`. |
| New task won't load | Auto-discovery requires the folder + an `index.ts` default-exporting `task()`. No manual registration needed — and none possible to "forget." |
| Module resolution error in Lab 2 | Make sure imports use `@renderinc/sdk/workflows` and `@workshop/agent` (workspace packages, not relative paths). |
| UX reviewer never fires | It only runs when the diff has frontend files (`.tsx/.jsx/.vue/.css`…). Use a PR that touches them. |
| Big PR times out (real model) | That's literally Pattern 1's failure mode. Switch to a small PR to keep pace. |

## 8. Solutions

### Lab 1 — `processEntry` (worker-agents/src/kv.ts)

```ts
export async function processEntry(
  client: Redis,
  id: string,
  fields: string[],
  handler: (job: ReviewJob) => Promise<void>,
): Promise<void> {
  const job = fieldsToJob(fields)
  try {
    if (job) await handler(job)
    await client.xack(STREAM, GROUP, id)
  } catch (err) {
    console.error('[kv] handler failed, leaving message un-acked for retry:', err)
  }
}
```

Why it's correct: the `xack` is *inside* the `try`, after a successful handler, so a
failure skips it and the message stays pending. The `catch` logs and returns —
never rethrows — so the blocking consumer loop in `consumeReviews` keeps running.

### Lab 2 — `your-review` (compose an agent as a task)

```ts
import { task } from "@renderinc/sdk/workflows";
import { securityReviewer } from "@workshop/agent";
import { storeTracer } from "@workshop/db";

const securityTask = task(
  { name: "security", timeoutSeconds: 120 },
  async (input: { patches: Patch[] }, runId?: string) => {
    return securityReviewer.run(input, { tracer: storeTracer(), runId });
  },
);

// inside yourReview, after you have filtered.patches:
const review = await securityTask({ patches: filtered.patches });
return { ...existingReturn, review: review.text };
```

Bonus (fan out both reviewers):

```ts
import { REVIEWERS } from "@workshop/agent";
const reviews = await Promise.all(
  REVIEWERS.map((agent) =>
    task(
      { name: agent.name },
      async (input: { patches: Patch[] }) => agent.run(input, { tracer: storeTracer() }),
    )({ patches: filtered.patches }),
  ),
);
```

This is the same fan-out as the built-in `code-review` workflow — have learners diff
their file against
[`code-review/index.ts`](../../packages/workflow-agents/src/workflows/code-review/index.ts).

---

## 9. Assessment / exit ticket

Quick checks that learners hit the objectives (use any 2–3):

1. "Give one failure mode of Pattern 1 and the Pattern 2 feature that fixes it"
2. "In Lab 1, why must the handler error *not* escape `processEntry`?"
3. "What two things make up a Render `task()`?" (a config object + an async fn)
4. "Where did the retry logic live in Pattern 2 vs Pattern 3?"

