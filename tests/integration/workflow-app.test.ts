delete process.env.DATABASE_URL
process.env.RENDER_USE_LOCAL_DEV = 'true'

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../../packages/workflow-agents/src/server.js'
import { installGithubStub, TEST_PR_URL, waitFor } from '../helpers.js'

let restore: () => void

before(() => {
  restore = installGithubStub()
})
after(() => restore())

test('POST /api/reviews dispatches the workflow and persists the result', async () => {
  const app = await createApp()

  const res = await app.fetch(
    new Request('http://test/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prUrl: TEST_PR_URL }),
    }),
  )
  assert.equal(res.status, 202)
  const { id } = (await res.json()) as { id: string }
  assert.ok(id)

  // The workflow runs in the background; poll until it settles.
  let final:
    | {
        review: { status: string; verdict: string; input_tokens: number; output_tokens: number }
        findings: unknown[]
      }
    | undefined
  await waitFor(async () => {
    const detail = await app.fetch(new Request(`http://test/api/reviews/${id}`))
    final = (await detail.json()) as typeof final
    return final?.review.status !== 'running'
  })

  assert.equal(final?.review.status, 'done')
  assert.equal(final?.review.verdict, 'approve')
  assert.ok((final?.findings.length ?? 0) >= 2)
  assert.equal(typeof final?.review.input_tokens, 'number')
  assert.equal(typeof final?.review.output_tokens, 'number')
})

test('healthz reports ok', async () => {
  const app = await createApp()
  const res = await app.fetch(new Request('http://test/healthz'))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})
