# 05 — Future iterations (beyond the workshop)

> **Take-home.** The facilitator will point you here during the close (~10 min).
> Nothing in this doc is implemented — it's the production road map, framed as
> "more steps, tasks, budgets, and tracers. Still the same agent."

> The workshop ends at a durable, traced, multi-agent reviewer. Shipping that to
> production is a different project. This doc captures the four most common next
> steps — **evals, guardrails, circuit breakers, and deeper observability** — and,
> for each, where it would plug into *this* codebase. Nothing here is implemented;
> it's a map, not a checklist.

The theme is the same as the rest of the workshop: each of these is *coordination
and lifecycle* work. On a naive or worker substrate you own all of it; on
Workflows you mostly express it as more tasks, steps, and config.

---

## 1. An eval harness

**The problem.** "It worked on the demo PR" is not a quality bar. Prompt tweaks,
model swaps, and tool changes silently regress. You need to measure review quality
on a fixed set of PRs and catch regressions before they ship.

**What it looks like.**

- A **labeled corpus**: a set of `(PR URL or fixture diff → expected verdict +
  must-catch findings)` cases. Start small (10–20) and grow from real misses.
- A **runner** that executes `runReview()` (or the `code-review` task) over the
  corpus and scores each result: did the verdict match? were the must-catch
  findings present? did it hallucinate line numbers?
- **Scorers**: exact-match for the verdict, recall on must-catch findings, and an
  LLM-as-judge rubric for the soft stuff (precision, signal-to-noise).
- A **report** (pass rate, regressions vs. the last run) wired into CI.

**Where it plugs in here.**

- The deterministic **mock model** already makes runs reproducible — evals can run
  offline in CI with zero credentials, then optionally re-run against a real model
  on a schedule.
- `prepareDiff` accepts a URL today; add a fixture path mode so cases don't depend
  on GitHub being up. Store fixture diffs under `tests/fixtures/`.
- `parseDecision` gives you a structured `{ verdict, reason, findings }` to score
  against expectations — the scorer is mostly set comparison.
- A new `your-review`-style task (`eval-run`) could fan out one review task per
  case with `Promise.all` and aggregate — the corpus *is* the fan-out.

**The substrate payoff.** Each eval case is an isolated, retried task; a flaky
network fetch retries instead of poisoning the whole run, and every case has its
own trace to inspect when a score drops.

---

## 2. Guardrails

**The problem.** Agents will, eventually, leak a secret into output, follow an
injected instruction hidden in a diff, cite a line that doesn't exist, or return
malformed JSON. Guardrails are the input/output validation layer that keeps a
misbehaving model from becoming a misbehaving *system*.

**What it looks like.**

- **Input guards**: strip or flag prompt-injection attempts in the diff before an
  agent sees it (`"ignore previous instructions"` smuggled into a comment).
- **Output guards**: validate the judge's JSON against a schema; re-ask on failure;
  redact anything that looks like a credential in agent prose; verify cited line
  numbers actually exist in the patch.
- **Tool guards**: an allow/deny list per agent, plus argument validation before a
  tool runs.

**Where it plugs in here.**

- `filterDiff` is already the first guard — it drops noise before the expensive
  fan-out. Input guards extend the same idea: a deterministic step that sanitizes
  or annotates patches.
- `parseDecision` already tolerates malformed judge output (it falls back to
  `verdict: "unknown"`). A guard would turn that fallback into a **re-ask loop**
  (see the reflection loop in [04 — Bonus points](04-author-a-task.md)) or a hard
  failure, instead of silently degrading.
- The agent loop already enforces `permissions.allowedTools` / `deniedTools`
  (`shared/agent/src/loop.ts`); `requireApproval` is the unfinished hook for a
  human-gated tool guard.
- The existing `scan_for_secrets` tool is a guard primitive — promote it from
  "tool the agent may call" to "step that always runs on output."

**The substrate payoff.** Guards are just more deterministic steps and small tasks
in the graph; failures get retried or surfaced as their own spans rather than
crashing the run.

---

## 3. Circuit breakers

**The problem.** A degraded dependency (a slow model, a rate-limited GitHub, a
flapping MCP server) shouldn't let work pile up unboundedly or burn your token
budget retrying a hopeless call. Retries handle *transient* failures; circuit
breakers handle *sustained* ones.

**What it looks like.**

- **Budgets**: per-run caps on tokens, wall-clock, and tool calls — stop and return
  a partial result instead of spinning.
- **Breakers**: after N consecutive failures to a dependency, "open" the circuit —
  fail fast (or fall back to the mock model) for a cooldown window instead of
  hammering it.
- **Backpressure**: cap concurrent in-flight reviews; shed or queue load past the
  cap.

**Where it plugs in here.**

- The `Budget` type (`maxIterations`, `maxTokens`, `maxWallSeconds`) already exists
  and is threaded into the loop — production-izing means setting real values per
  agent and surfacing budget-exhaustion as a first-class outcome, not a thrown
  error.
- Task `retry` config (`maxRetries`, `backoffScaling`) is the *transient*-failure
  half; a breaker is the deterministic step that decides whether to even *attempt*
  the next task, based on recent failure counts in a shared store.
- A model-tier fallback (`MODEL_TIERS`) is a natural breaker action: when the large
  judge model is unhealthy, drop to a smaller tier or the mock and flag the run as
  degraded.

**The substrate payoff.** Per-task timeouts and retries are already declarative;
the breaker is the small bit of *state* (failure counts, open/closed) you add on
top — and durable execution is exactly what makes that state survive restarts.

---

## 4. Observability deep-dives

**The problem.** The workshop ships traces (agent → LLM turn → tool spans, in the
telemetry viewer and the Render Dashboard). Production needs to answer harder
questions: *what's our p95 review latency? token spend per repo? which agent fails
most? did last week's prompt change move quality or just cost?*

**What it looks like.**

- **Metrics**: latency/percentiles, token spend, verdict distribution, per-agent
  failure rate, retry counts — emitted per run and aggregated over time.
- **Structured logs** correlated by `runId` end-to-end (already the spine of the
  tracing model here).
- **Cost attribution**: tokens × model price, grouped by agent, repo, and verdict.
- **Trace export**: ship spans to OpenTelemetry / your APM instead of (or in
  addition to) the built-in viewer.
- **Alerting**: page when failure rate or cost crosses a threshold.

**Where it plugs in here.**

- The `Tracer` interface (`onStart` / `onEnd` over `SpanInfo`) is the seam:
  `storeTracer()` writes to Postgres today; a second tracer could fan the same
  spans to OTel with no change to agent code (tracers compose).
- `AgentResult.usage` already carries `inputTokens` / `outputTokens` per agent —
  cost attribution is aggregation over data you already collect.
- `runId` already correlates every span in a run; extend it to correlate logs and
  exported metrics so one id stitches the whole picture together.
- The telemetry viewer (`@workshop/ui`) is read-only over `@workshop/db` — add
  aggregate views (latency, spend, verdict mix) without touching the agents.

**The substrate payoff.** Because every agent already runs as a traced task, the
raw signal exists; the deep-dive work is aggregation and export, not
instrumentation you have to retrofit into the agent.

---

## How these relate

These four reinforce each other, and they layer cleanly onto the task graph:

```
            ┌─ guardrails (validate in/out) ─┐
trigger ──▶ │  prepareDiff → filterDiff →     │ ──▶ verdict
            │  [reviewers] → judge            │
            └─ circuit breakers (budgets,     ┘
               breakers, fallbacks)
                        │
            observability ── traces, metrics, cost ── feeds ──▶ evals
                                                                 │
                                              evals catch regressions before deploy
```

- **Evals** tell you whether a change helped or hurt.
- **Guardrails** keep individual runs safe and well-formed.
- **Circuit breakers** keep the system stable when a dependency degrades.
- **Observability** is the data layer all three read from.

None of it changes the agent. As with every pattern in this workshop, it's the
substrate — now extended with steps, tasks, budgets, and tracers — doing the work.
