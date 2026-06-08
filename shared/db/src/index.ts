/**
 * Telemetry store: reviews, findings, and agent spans — the durable record the
 * UI reads, and the span sink the agent loop writes through.
 *
 * Backend selection is automatic:
 *   - DATABASE_URL set  → Postgres (durable; required for multi-process worker-agents)
 *   - DATABASE_URL unset → in-memory (keyless, zero-setup local dev)
 *
 * The public functions below have the same shape regardless of backend. The pg
 * path keeps an optional `pool` parameter for test injection; passing a pool
 * forces the pg backend.
 */
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import type { SpanInfo, SpanOutcome, Tracer } from '@workshop/agent'
import * as mem from './memory.js'
import type { FindingRow, ReviewMeta, ReviewResultUpdate, ReviewRow, SpanRow } from './types.js'

export type { FindingRow, ReviewMeta, ReviewResultUpdate, ReviewRow, SpanRow } from './types.js'

const { Pool } = pg
type PgPool = pg.Pool

let _pool: PgPool | undefined

export function getPool(): PgPool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
    _pool = new Pool({ connectionString: process.env.DATABASE_URL })
  }
  return _pool
}

/** True when a real Postgres backend should be used (explicit pool or DATABASE_URL). */
function usePg(pool?: PgPool): boolean {
  return !!pool || !!process.env.DATABASE_URL
}

export async function migrate(pool?: PgPool): Promise<void> {
  if (!usePg(pool)) return // in-memory: nothing to migrate
  const active = pool ?? getPool()
  const schemaPath = new URL('../schema.sql', import.meta.url)
  const sql = await readFile(schemaPath, 'utf-8')
  await active.query(sql)
}

// ── Reviews ────────────────────────────────────────────────────────────────

export async function createReview(
  prUrl: string,
  meta: ReviewMeta = {},
  pool?: PgPool,
): Promise<string> {
  if (!usePg(pool)) return mem.createReview(prUrl, meta)
  const active = pool ?? getPool()
  const id = globalThis.crypto.randomUUID()
  await active.query(
    'INSERT INTO reviews (id, pr_url, status, source, workflow) VALUES ($1, $2, $3, $4, $5)',
    [id, prUrl, 'running', meta.source ?? null, meta.workflow ?? null],
  )
  return id
}

export async function setReviewResult(
  id: string,
  update: ReviewResultUpdate,
  pool?: PgPool,
): Promise<void> {
  if (!usePg(pool)) return mem.setReviewResult(id, update)
  const active = pool ?? getPool()
  await active.query(
    `UPDATE reviews
       SET status = $2,
           verdict = $3,
           reason = $4,
           input_tokens = $5,
           output_tokens = $6,
           updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      update.status,
      update.verdict ?? null,
      update.reason ?? null,
      update.inputTokens ?? 0,
      update.outputTokens ?? 0,
    ],
  )
}

export async function listReviews(limit = 50, pool?: PgPool): Promise<ReviewRow[]> {
  if (!usePg(pool)) return mem.listReviews(limit)
  const active = pool ?? getPool()
  const { rows } = await active.query<ReviewRow>(
    'SELECT * FROM reviews ORDER BY created_at DESC LIMIT $1',
    [limit],
  )
  return rows
}

export async function getReview(id: string, pool?: PgPool): Promise<ReviewRow | undefined> {
  if (!usePg(pool)) return mem.getReview(id)
  const active = pool ?? getPool()
  const { rows } = await active.query<ReviewRow>('SELECT * FROM reviews WHERE id = $1', [id])
  return rows[0]
}

// ── Findings ───────────────────────────────────────────────────────────────

export async function addFinding(
  reviewId: string,
  agent: string,
  note: string,
  pool?: PgPool,
): Promise<void> {
  if (!usePg(pool)) return mem.addFinding(reviewId, agent, note)
  const active = pool ?? getPool()
  await active.query('INSERT INTO findings (review_id, agent, note) VALUES ($1, $2, $3)', [
    reviewId,
    agent,
    note,
  ])
}

export async function getFindings(reviewId: string, pool?: PgPool): Promise<FindingRow[]> {
  if (!usePg(pool)) return mem.getFindings(reviewId)
  const active = pool ?? getPool()
  const { rows } = await active.query<FindingRow>(
    'SELECT * FROM findings WHERE review_id = $1 ORDER BY id ASC',
    [reviewId],
  )
  return rows
}

// ── Spans (telemetry) ────────────────────────────────────────────────────────

export async function getSpans(runId: string, pool?: PgPool): Promise<SpanRow[]> {
  if (!usePg(pool)) return mem.getSpans(runId)
  const active = pool ?? getPool()
  const { rows } = await active.query<SpanRow>(
    'SELECT * FROM spans WHERE run_id = $1 ORDER BY started_at ASC',
    [runId],
  )
  return rows
}

/**
 * A Tracer that writes spans to the active backend. Best-effort: failures are
 * logged and swallowed so telemetry never breaks a run. Pass to runReview.
 */
export function storeTracer(pool?: PgPool): Tracer {
  if (!usePg(pool)) return mem.storeTracer()
  const active = pool ?? getPool()
  const fail = (err: unknown) => console.warn('[db] span write failed:', err)
  return {
    onStart(span: SpanInfo, input: unknown) {
      active
        .query(
          `INSERT INTO spans (span_id, run_id, parent_span_id, name, kind, status, input)
           VALUES ($1, $2, $3, $4, $5, 'running', $6)
           ON CONFLICT (span_id) DO NOTHING`,
          [span.spanId, span.runId, span.parentSpanId ?? null, span.name, span.kind, toJson(input)],
        )
        .catch(fail)
    },
    onEnd(span: SpanInfo, outcome: SpanOutcome) {
      active
        .query(
          `UPDATE spans
             SET status = $2, output = $3, error = $4, ended_at = NOW()
           WHERE span_id = $1`,
          [
            span.spanId,
            outcome.ok ? 'ok' : 'error',
            outcome.ok ? toJson(outcome.output) : null,
            outcome.ok ? null : outcome.error,
          ],
        )
        .catch(fail)
    },
  }
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return JSON.stringify(String(value))
  }
}
