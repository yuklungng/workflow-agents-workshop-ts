/**
 * worker-agents — web tier (producer).
 *
 * The web service no longer runs the agent. It validates the request, creates a
 * review record, drops a job on the Valkey queue, and returns immediately. The
 * heavy work happens in a separate Background Worker (see worker.ts), so the web
 * tier stays responsive and a redeploy here never kills an in-flight review.
 */
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createReview, migrate } from '@workshop/db'
import { enqueueReview, subscribeProgress } from './kv.js'
import { createUiRouter } from '@workshop/ui'

/** Build the Hono app. Exported so tests can drive it via `app.fetch`. */
export function createApp(): Hono {
  const app = new Hono()

  app.get('/healthz', (c) => c.text('ok'))

  app.post('/api/reviews', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { prUrl?: string }
    if (!body.prUrl) return c.json({ error: 'prUrl is required' }, 400)

    const id = await createReview(body.prUrl, { source: 'worker-agents', workflow: 'code-review' })
    await enqueueReview({ reviewId: id, prUrl: body.prUrl })
    // Return right away — the worker will pick it up. This is the whole point.
    return c.json({ id, status: 'queued' }, 202)
  })

  // Live progress for one review, streamed from the worker over pub/sub.
  app.get('/api/reviews/:id/stream', (c) => {
    const id = c.req.param('id')
    return streamSSE(c, async (stream) => {
      let done = false
      const unsubscribe = await subscribeProgress(id, (event) => {
        void stream.writeSSE({ data: JSON.stringify(event) })
        const e = event as { type?: string; phase?: string }
        if (e.type === 'error' || (e.type === 'phase' && e.phase === 'done')) done = true
      })
      stream.onAbort(() => unsubscribe())
      while (!done && !stream.aborted) {
        await stream.sleep(1000)
      }
      unsubscribe()
    })
  })

  app.route('/', createUiRouter('worker-agents'))

  return app
}

// Run as a server only when invoked directly (not when imported by tests).
if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  await migrate()
  const port = Number(process.env.PORT ?? 3000)
  serve({ fetch: createApp().fetch, port }, (info) => {
    console.info(`[worker-agents:web] listening on http://localhost:${info.port}`)
  })
}
