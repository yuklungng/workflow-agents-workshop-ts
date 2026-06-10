/**
 * Pattern 1 - Naive agent.
 *
 * One web service. The code-review agent runs *in-process, inside the request*:
 * the POST handler awaits the whole pipeline before responding. Simple
 * but it doesn't scale. A big PR ties up the request, a
 * redeploy kills in-flight reviews, and concurrent users compete for one process.
 * Patterns 2 and 3 fix that.
 */
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { runReview } from '@workshop/agent'
import { createReview, migrate, persistReview, setReviewResult, storeTracer } from '@workshop/db'
import { createUiRouter } from '@workshop/ui'

/** Build the Hono app. Exported so tests can drive it via `app.fetch`. */
export function createApp(): Hono {
  const app = new Hono()

  app.get('/healthz', (c) => c.text('ok'))

  app.post('/api/reviews', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { prUrl?: string }
    if (!body.prUrl) return c.json({ error: 'prUrl is required' }, 400)

    const id = await createReview(body.prUrl, { source: 'naive-agent', workflow: 'code-review' })

    // The naive part: we run the whole review here and block until it's done.
    try {
      const result = await runReview(body.prUrl, { runId: id, tracer: storeTracer() })
      await persistReview(id, result.summary)
      return c.json({ id, verdict: result.summary.verdict })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await setReviewResult(id, { status: 'error', reason: message })
      return c.json({ id, error: message }, 500)
    }
  })

  // Telemetry viewer (page + read APIs) at the root.
  app.route('/', createUiRouter('localhost Workshop: Naive Agent'))

  return app
}

// Run as a server only when invoked directly (not when imported by tests).
if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  await migrate()
  const port = Number(process.env.PORT ?? 3000)
  serve({ fetch: createApp().fetch, port }, (info) => {
    console.info(`[naive-agent] listening on http://localhost:${info.port}`)
  })
}
