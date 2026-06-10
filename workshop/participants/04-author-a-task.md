# 04 — Author a task (the hands-on finale)

> **Session 2 — Lab 2 (~25 min).** This is the highest-value segment and the
> reason for everything before it. Coding agents are welcome — the `task()` API
> is small enough that they reason about it directly. Steps 1–3 are the core;
> 4–5 are stretch goals. Bonus points at the bottom are take-home challenges.

> This is the half where coding agents come out. Open `your-review` and treat it
> as a sandbox — extend it however you like. The API is small enough that an agent
> reasons about it trivially. (In Session 1 you hand-wrote the worker's acks. Here,
> you compose tasks and inspect the live run.)

## Anatomy of a task

```ts
import { task } from "@renderinc/sdk/workflows";

export default task(
  {
    name: "your-review",
    timeoutSeconds: 120,
    retry: { maxRetries: 2, waitDurationMs: 1000, backoffScaling: 2 },
  },
  async function yourReview(input) {
    // ...your logic...
  },
);
```

That's the whole API surface:

- **A config object** — `name`, `timeoutSeconds`, `retry` (maxRetries / backoff),
  optional `plan` (compute size).
- **A function** — any `async (input) => result`.

Three things you get for free, that `worker-agents/src/kv.ts` had to build by hand:

| You write | Render gives you |
| --- | --- |
| `retry: { maxRetries: 2, … }` | automatic retries with backoff, in a fresh instance |
| `await someTask({ input })` | isolation — each task runs in its own container |
| nothing | a full trace of every task + sub-task run |

And **composition is just function calls**: call a task from inside a task. Wrap
them in `Promise.all` to fan out. A *deterministic step* (pure logic) is just a
plain function — no `task()` needed.

## Your turn

Open [`packages/workflow-agents/src/workflows/your-review/index.ts`](../../packages/workflow-agents/src/workflows/your-review/index.ts).
It's a working sandbox that fetches a PR and returns an overview. Explore from
there. The file ends with commented ideas, not a prescribed fill-in.

### 1. Preview what's there locally

```sh
cd packages/workflow-agents
npm install            # from repo root if first time
npm run dev:workflows  # terminal A
```

In terminal B:

```sh
render workflows tasks list --local
render workflows start your-review --local \
  --input='[{"url":"https://github.com/<owner>/<repo>/pull/<n>"}]'
```

You just ran a task. Note: you never registered it anywhere. `loader.ts`
discovered it because the folder exists and exports a task.

### 2. Compose an agent as a task

Pick one reviewer and run it as its own isolated task. Example — security:

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

// inside yourReview, after you have `filtered.patches`:
const review = await securityTask({ patches: filtered.patches });
return { ...existingReturn, review: review.text };
```

Re-run locally. You should see `your-review` call a nested `security` agent task.
After you ship the task live, that same nesting shows up as a Dashboard trace with
LLM turns and token usage.

### 3. See the power: force a retry

Temporarily throw at the top of the task body:

```ts
if (Math.random() < 0.5) throw new Error("flaky!");
```

Re-run a few times and watch Render retry in a fresh instance per your `retry`
config. There is no try/catch, queue, or dead-letter logic. Remove it when done.

### 4. Bonus — fan out

Swap the single reviewer for both, in parallel:

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

That's the same fan-out as the built-in `code-review` workflow. Compare your file
to [`code-review/index.ts`](../../packages/workflow-agents/src/workflows/code-review/index.ts).

### 5. Ship it live

Commit and push your task changes to the branch your Workflow service tracks:

```sh
git add packages/workflow-agents/src/workflows/your-review/index.ts
git commit -m "Extend your-review workflow"
git push
```

Release or redeploy the Workflow service, then start the live task:

```sh
render workflows versions release <workflow-id>
render workflows start workflow-agents/your-review \
  --input='[{"url":"https://github.com/<owner>/<repo>/pull/<n>"}]'
```

Open the run in the Render Dashboard. The payoff is the trace: `your-review`
contains the reviewer task runs, retry attempts if you forced a failure, and the
final returned result.

### 6. Go further (quick wins)

Choose one of these next steps:

- Add `parseDecision` + `judge` for a full verdict (mirror `code-review`).
- Use `selectReviewers` / `hasFrontendFiles` for conditional UX review.
- Add a custom tool in `shared/agent/src/tools/` and wire it to an agent.
- Return raw patch previews for debugging, or strip them to keep output small.

## Bonus points

Three deeper, guided challenges. Each adds a real agentic capability on top of
`your-review` and reinforces the same lesson — **the substrate makes hard things
declarative**. Do them in any order. They're independent. None requires an API key
(the mock model exercises every path).

### Bonus 1 — Add a reflection loop to the judge

**Goal:** instead of the judge emitting a verdict in one shot, have it critique its
own draft and revise before returning. Reflection (a.k.a. self-critique) is one of
the highest-leverage agent patterns — a second pass catches the judge's own
over/under-reactions.

**How it works here:** a reflection loop is just *calling the same task again with
its previous output fed back in*. In a queue you'd hand-roll the re-enqueue. As a
task it's a `for` loop over a `judgeTask`.

**Build it** in `your-review` (building on the fan-out from step 4):

```ts
import { task } from "@renderinc/sdk/workflows";
import { REVIEWERS, judge, parseDecision } from "@workshop/agent";
import { storeTracer } from "@workshop/db";

const judgeTask = task(
  { name: "judge", timeoutSeconds: 120 },
  async (input: Record<string, unknown>) => judge.run(input, { tracer: storeTracer() }),
);

// Fan out reviewers, then pair each result with its agent name for the judge.
const results = await Promise.all(
  REVIEWERS.map((agent) =>
    task(
      { name: agent.name },
      async (input: { patches: Patch[] }) => agent.run(input, { tracer: storeTracer() }),
    )({ patches: filtered.patches }),
  ),
);
const findings = REVIEWERS.map((agent, i) => ({ agent: agent.name, note: results[i].text }));

// Draft → reflect → settle. The judge sees its own prior verdict each pass and
// is asked to find weaknesses before committing. parseDecision guards the JSON.
let decision = parseDecision((await judgeTask({ findings })).text);
const MAX_REFLECTIONS = 2;
for (let pass = 0; pass < MAX_REFLECTIONS; pass++) {
  const reflected = await judgeTask({
    findings,
    previousVerdict: decision,
    instruction:
      "Critique your previous verdict. If a finding was over- or under-weighted, " +
      "revise. Return the same JSON shape — your final answer only.",
  });
  const next = parseDecision(reflected.text);
  if (next.verdict === decision.verdict && next.reason === decision.reason) break; // converged
  decision = next;
}
return { url: input.url, verdict: decision.verdict, reason: decision.reason };
```

The judge reads its `input` as JSON (the loop serializes the whole object into the
user message), so the extra `previousVerdict` / `instruction` keys just show up in
its context — no prompt surgery needed.

**Verify:** run it and watch the trace — you'll see the `judge` task invoked
multiple times under one `your-review` run, each its own isolated, retried,
traced instance. The loop is *your* control flow. Durability is still the
platform's.

**Stretch:** make the loop stop early on a confidence signal, or fan out two judges
with different temperatures (`sampling`) and reconcile them.

### Bonus 2 — Wire in an MCP tool

**Goal:** give a reviewer a tool backed by an external [MCP](https://modelcontextprotocol.io)
server — the same way you'd plug in a real capability (web fetch, a vuln database,
your own internal service).

**How it works here:** tools and MCP sources come from the **shared registry**, so
wiring one makes it available to all three patterns at once. The registry already
supports MCP via `defineMcpSource` — it's opt-in and lazily imported, so the base
package never needs the SDK.

**Build it** — add the optional dependency, then drop a source file in the shared
tools dir:

```sh
npm install @modelcontextprotocol/sdk --workspace @workshop/agent
```

```ts
// shared/agent/src/tools/docs-mcp.ts
import { defineMcpSource } from "./tool.js";

// Stdio transport: the registry spawns this command and connects over stdio.
// Tools are auto-namespaced as `docs__<toolName>`.
export default defineMcpSource({
  id: "docs",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
});
```

Then let an agent use it. MCP tool ids are namespaced `<source-id>__<tool>`, so
reference them by that name in the agent's `tools` array (e.g. add
`"docs__read_file"` to `securityReviewer.tools` in `shared/agent/src/agents.ts`),
or grant access via the agent's `permissions.allowedTools`.

**Verify:** run a reviewer task and look at the trace — you'll see a `tool` span
for the MCP call nested under the agent's LLM turns. `resolveTools()` connects the
source on `agent.run()` and tears the connection down afterward. You wrote none of
that lifecycle.

**Stretch:** point `defineMcpSource` at an HTTP/SSE server instead (`url: …`), or
gate the new tool behind `permissions.deniedTools` for the agents that shouldn't
see it.

### Bonus 3 — Add a human-in-the-loop (HITL) gate

**Goal:** before a `request-changes` verdict (or any `block` finding) becomes
"actioned," require a human to approve or override it. This is the pattern behind
"the agent proposes, a person disposes."

**How it works here:** durable execution is what makes HITL *easy*. The hard part of
HITL is the wait — work has to survive an arbitrarily long pause for a human. In
Pattern 1 that pause dies with the request. In Pattern 2 you'd own the parked-job
bookkeeping. With tasks, you split the workflow at the decision boundary and let the
platform hold state between the halves.

**Build it** as a two-phase shape in `your-review` (sketch — wire the store to
Postgres via `@workshop/db`, or any KV):

```ts
// Phase 1 — propose. Deterministic gate decides if a human is needed.
const decision = parseDecision((await judgeTask({ findings })).text);
const needsHuman =
  decision.verdict === "request-changes" ||
  decision.findings.some((f) => f.severity === "block");

if (needsHuman) {
  await savePendingApproval(input.url, decision);     // park it durably
  return { status: "awaiting-approval", verdict: decision.verdict };
}
return { status: "auto-approved", verdict: decision.verdict };

// Phase 2 — a separate task (or webhook) the human triggers to resolve it:
//   resolveApproval(url, "approve" | "reject") → finalize and act.
```

A lighter-weight variant lives **inside the agent loop**: the shared `Permissions`
type already has a `requireApproval?: string[]` field for gating specific tools.
It isn't enforced yet (`loop.ts` only honors `allowedTools` / `deniedTools`) —
wiring it so a listed tool pauses for approval before `dispatch()` is a focused,
self-contained exercise in where a HITL checkpoint belongs.

**Verify:** trigger a PR that earns `request-changes` → the run returns
`awaiting-approval` instead of finalizing. Resolve it from the second task and
watch both halves show up as separate runs in the trace, linked by the PR URL.

**Stretch:** add a timeout that auto-rejects (or auto-escalates) if no human
responds — now you've combined HITL with a circuit breaker (see
[05 — Future iterations](05-future-iterations.md)).

## The takeaway

You added durable, retried, isolated, traced, parallel execution by writing a
plain function and a config object. In worker-agents that same set of guarantees took
a queue, a consumer group, acks, retries, and a pub/sub bus — all code you had to
own and debug. That is the whole arc of the workshop: the agent never changed.
The substrate did all the work.

Where to next? [05 — Future iterations](05-future-iterations.md) sketches what it
takes to run this in production: an eval harness, guardrails, circuit breakers,
and observability deep-dives.
