/**
 * In-memory backend for @workshop/db. Selected automatically when DATABASE_URL is
 * unset, so local dev runs keyless and database-less. On deploy, Render provisions
 * Postgres and index.ts switches to the pg backend automatically.
 *
 * Caveat: this state is per-process. worker-agents runs its web and worker as
 * separate processes, so it needs real Postgres to share state between them.
 */
import type { SpanInfo, SpanOutcome, Tracer } from '@workshop/agent'
import type { FindingRow, ReviewMeta, ReviewResultUpdate, ReviewRow, SpanRow } from './types.js'

const reviews = new Map<string, ReviewRow>()
const findings: FindingRow[] = []
const spans = new Map<string, SpanRow>()
let findingSeq = 1

export function createReview(prUrl: string, meta: ReviewMeta = {}): string {
  const id = globalThis.crypto.randomUUID()
  const now = new Date().toISOString()
  reviews.set(id, {
    id,
    pr_url: prUrl,
    status: 'running',
    verdict: null,
    reason: null,
    source: meta.source ?? null,
    workflow: meta.workflow ?? null,
    input_tokens: 0,
    output_tokens: 0,
    created_at: now,
    updated_at: now,
  })
  return id
}

export function setReviewResult(id: string, update: ReviewResultUpdate): void {
  const review = reviews.get(id)
  if (!review) return
  review.status = update.status
  review.verdict = update.verdict ?? null
  review.reason = update.reason ?? null
  review.input_tokens = update.inputTokens ?? 0
  review.output_tokens = update.outputTokens ?? 0
  review.updated_at = new Date().toISOString()
}

export function listReviews(limit = 50): ReviewRow[] {
  return [...reviews.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
}

export function getReview(id: string): ReviewRow | undefined {
  return reviews.get(id)
}

export function addFinding(reviewId: string, agent: string, note: string): void {
  findings.push({
    id: findingSeq++,
    review_id: reviewId,
    agent,
    note,
    created_at: new Date().toISOString(),
  })
}

export function getFindings(reviewId: string): FindingRow[] {
  return findings.filter((f) => f.review_id === reviewId).sort((a, b) => a.id - b.id)
}

export function getSpans(runId: string): SpanRow[] {
  return [...spans.values()]
    .filter((s) => s.run_id === runId)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
}

export function storeTracer(): Tracer {
  return {
    onStart(span: SpanInfo, input: unknown) {
      if (spans.has(span.spanId)) return
      spans.set(span.spanId, {
        span_id: span.spanId,
        run_id: span.runId,
        parent_span_id: span.parentSpanId ?? null,
        name: span.name,
        kind: span.kind,
        status: 'running',
        input,
        output: null,
        error: null,
        started_at: new Date().toISOString(),
        ended_at: null,
      })
    },
    onEnd(span: SpanInfo, outcome: SpanOutcome) {
      const existing = spans.get(span.spanId)
      if (!existing) return
      existing.status = outcome.ok ? 'ok' : 'error'
      existing.output = outcome.ok ? outcome.output : null
      existing.error = outcome.ok ? null : outcome.error
      existing.ended_at = new Date().toISOString()
    },
  }
}
