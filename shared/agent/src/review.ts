/**
 * The code-review orchestration used by naive-agent and worker-agents.
 *
 *   prepareDiff → filterDiff → [security ‖ performance ‖ ux?] (Promise.all) → judge
 *
 * The UX reviewer is conditionally branched in only when the diff touches
 * frontend files. Substrate-agnostic: it doesn't know whether it runs in a web
 * request or a queue worker. Progress is surfaced via the `onEvent` callback so a
 * worker can stream it over pub/sub. workflow-agents expresses the same shape as
 * Render tasks.
 */
import { prepareDiff, type Patch } from './prepareDiff.js'
import { filterDiff } from './filterDiff.js'
import { selectReviewers, judge } from './agents.js'
import type { AgentResult, RunContext, TokenUsage, Tracer } from './types.js'

export interface ReviewFinding {
  agent: string
  note: string
}

export interface ReviewDecision {
  verdict: string
  reason: string
  findings: Array<Record<string, unknown>>
  raw: string
}

export interface ReviewResult {
  prUrl: string
  patches: Patch[]
  reviews: ReviewFinding[]
  decision: ReviewDecision
  usage: TokenUsage
  /**
   * The flat, persist-ready shape (verdict + reason + reviews + usage). Every
   * substrate persists *this* via `persistReview`, so the bookkeeping is shared
   * and only the fan-out differs between patterns.
   */
  summary: ReviewSummary
}

/**
 * The flat summary a substrate persists and the viewer reads: the judge's
 * verdict + reason, the reviewer notes, and the run's total token usage. Shared
 * by `runReview` (naive/worker) and the workflow pattern so the only thing that
 * differs between substrates is the fan-out itself — not this bookkeeping.
 */
export interface ReviewSummary {
  verdict: string
  reason: string
  reviews: ReviewFinding[]
  usage: TokenUsage
}

/** Add up the token usage across a set of agent results. */
export function sumUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  )
}

/**
 * Shape the reviewer results and the judge's output into a `ReviewSummary`:
 * parse the verdict/reason, strip per-reviewer usage down to `{ agent, note }`,
 * and total the tokens. This is the boilerplate every substrate would otherwise
 * copy after its own fan-out.
 */
export function toReviewSummary(
  reviews: Array<{ agent: string; note: string; usage: TokenUsage }>,
  judgeResult: AgentResult,
): ReviewSummary {
  const decision = parseDecision(judgeResult.text)
  return {
    verdict: decision.verdict,
    reason: decision.reason,
    reviews: reviews.map(({ agent, note }) => ({ agent, note })),
    usage: sumUsage([...reviews.map((r) => r.usage), judgeResult.usage]),
  }
}

export type ReviewEvent =
  | { type: 'phase'; phase: 'prepare' | 'filter' | 'review' | 'judge' | 'done'; detail?: string }
  | { type: 'agent_start'; agent: string }
  | { type: 'agent_done'; agent: string; note: string }
  | { type: 'error'; message: string }

export interface RunReviewOptions {
  onEvent?: (event: ReviewEvent) => void | Promise<void>
  signal?: AbortSignal
  tracer?: Tracer
  /** Ties telemetry spans together — typically the persisted review id. */
  runId?: string
  /**
   * Break-glass: skip noise filtering and review the entire diff (lock files,
   * minified bundles, and all). Use only when you genuinely need full coverage.
   */
  breakGlass?: boolean
}

export async function runReview(prUrl: string, options: RunReviewOptions = {}): Promise<ReviewResult> {
  const { onEvent, signal, tracer, runId, breakGlass } = options
  const emit = async (event: ReviewEvent) => {
    await onEvent?.(event)
  }
  const ctx: RunContext = {
    ...(signal ? { signal } : {}),
    ...(tracer ? { tracer } : {}),
    ...(runId ? { runId } : {}),
  }

  await emit({ type: 'phase', phase: 'prepare' })
  const allPatches = await prepareDiff({ url: prUrl, labels: [] })

  // Deterministic, in-process step: drop noise before the expensive fan-out.
  const filtered = filterDiff(allPatches, { ...(breakGlass ? { breakGlass } : {}) })
  const patches = filtered.patches
  await emit({
    type: 'phase',
    phase: 'filter',
    detail: filtered.breakGlass
      ? `break-glass: reviewing all ${patches.length} files`
      : `${patches.length} files (${filtered.dropped.length} noise dropped)`,
  })

  // Conditional branching: UX reviewer joins only when the diff touches frontend.
  const reviewers = selectReviewers(patches)
  await emit({ type: 'phase', phase: 'review', detail: reviewers.map((r) => r.name).join(', ') })

  const reviews = await Promise.all(
    reviewers.map(async (agent) => {
      await emit({ type: 'agent_start', agent: agent.name })
      const result = await agent.run({ patches }, ctx)
      await emit({ type: 'agent_done', agent: agent.name, note: result.text })
      return { agent: agent.name, note: result.text, usage: result.usage }
    }),
  )

  await emit({ type: 'phase', phase: 'judge' })
  const judgeResult = await judge.run(
    { findings: reviews.map(({ agent, note }) => ({ agent, note })) },
    ctx,
  )

  await emit({ type: 'phase', phase: 'done' })

  // One summarization path, shared with the workflow pattern: parse the verdict,
  // flatten reviewer notes, and total the tokens.
  const summary = toReviewSummary(reviews, judgeResult)

  return {
    prUrl,
    patches,
    reviews: summary.reviews,
    decision: parseDecision(judgeResult.text),
    usage: summary.usage,
    summary,
  }
}

export function parseDecision(raw: string): ReviewDecision {
  const json = extractJson(raw)
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    return {
      verdict: typeof obj.verdict === 'string' ? obj.verdict : 'unknown',
      reason: typeof obj.reason === 'string' ? obj.reason : '',
      findings: Array.isArray(obj.findings) ? (obj.findings as Array<Record<string, unknown>>) : [],
      raw,
    }
  }
  return { verdict: 'unknown', reason: raw, findings: [], raw }
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}
