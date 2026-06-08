/**
 * worker-agents — background worker (consumer).
 *
 * Pulls review jobs off the Valkey stream and runs the *exact same* runReview()
 * as naive-agent — the only change is where it runs. Progress is published over
 * pub/sub so the web tier can stream it live. Run several of these to scale out;
 * Render scales a Background Worker independently of the web service.
 *
 * Note what we're hand-rolling here that workflow-agents (Render Workflows) gives for free:
 * the queue, consumer groups, acks, retry-on-failure, and progress plumbing.
 */
import { runReview } from '@workshop/agent'
import { addFinding, migrate, setReviewResult, storeTracer } from '@workshop/db'
import { consumeReviews, publishProgress } from './kv.js'

const controller = new AbortController()
process.on('SIGTERM', () => controller.abort())
process.on('SIGINT', () => controller.abort())

await migrate()
console.info(`[worker-agents:worker] ready (pid ${process.pid}), waiting for jobs…`)

await consumeReviews(
  async (job) => {
    console.info(`[worker-agents:worker] picked up review ${job.reviewId} (${job.prUrl})`)
    try {
      const result = await runReview(job.prUrl, {
        runId: job.reviewId,
        tracer: storeTracer(),
        onEvent: (event) => publishProgress(job.reviewId, event),
      })
      for (const finding of result.reviews) {
        await addFinding(job.reviewId, finding.agent, finding.note)
      }
      // Surface the judge's decision as its own finding alongside the specialists.
      await addFinding(job.reviewId, 'judge', result.decision.reason || result.decision.verdict)
      await setReviewResult(job.reviewId, {
        status: 'done',
        verdict: result.decision.verdict,
        reason: result.decision.reason,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await setReviewResult(job.reviewId, { status: 'error', reason: message })
      await publishProgress(job.reviewId, { type: 'error', message })
      throw err // leave the message un-acked so the queue can retry it
    }
  },
  { signal: controller.signal },
)
