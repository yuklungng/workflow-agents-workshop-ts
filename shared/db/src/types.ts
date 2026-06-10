/** Row shapes for the telemetry store, shared by the pg and memory backends. */

export interface ReviewRow {
  id: string
  pr_url: string
  status: string
  verdict: string | null
  reason: string | null
  /** Which package/pattern created the review (naive-agent, worker-agents, …). */
  source: string | null
  /** The workflow/pipeline that ran it (code-review, your-review, …). */
  workflow: string | null
  input_tokens: number
  output_tokens: number
  created_at: string
  updated_at: string
}

/** Optional provenance recorded when a review is created. */
export interface ReviewMeta {
  source?: string
  workflow?: string
}

export interface ReviewResultUpdate {
  /**
   * `done`/`error` are terminal; `queued` means a worker failed but left the job
   * un-acked for reclaim/retry (so the row reflects "back in the queue", not a
   * terminal failure).
   */
  status: 'done' | 'error' | 'queued'
  verdict?: string
  reason?: string
  inputTokens?: number
  outputTokens?: number
}

export interface FindingRow {
  id: number
  review_id: string
  agent: string
  note: string
  created_at: string
}

export interface SpanRow {
  span_id: string
  run_id: string
  parent_span_id: string | null
  name: string
  kind: string
  status: string
  input: unknown
  output: unknown
  error: string | null
  started_at: string
  ended_at: string | null
}
