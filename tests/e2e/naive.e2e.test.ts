delete process.env.DATABASE_URL

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { serve } from '@hono/node-server'
import { createApp } from '../../packages/naive-agent/src/server.js'
import { installGithubStub, TEST_PR_URL } from '../helpers.js'

let server: ReturnType<typeof serve>
let baseUrl: string
let restore: () => void

before(async () => {
  restore = installGithubStub()
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: createApp().fetch, port: 0 }, (info) => resolve(info.port))
  })
  baseUrl = `http://localhost:${port}`
})

after(() => {
  server.close()
  restore()
})

test('e2e: a PR is reviewed over real HTTP and shows in the viewer', async () => {
  // The GitHub stub passes localhost requests through to the real server.
  const post = await fetch(`${baseUrl}/api/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prUrl: TEST_PR_URL }),
  })
  assert.equal(post.status, 200)
  const { id, verdict } = (await post.json()) as { id: string; verdict: string }
  assert.equal(verdict, 'approve')

  const list = await fetch(`${baseUrl}/api/reviews`)
  const rows = (await list.json()) as Array<{ id: string; status: string }>
  const row = rows.find((r) => r.id === id)
  assert.equal(row?.status, 'done')

  const page = await fetch(`${baseUrl}/`)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /naive agent/i)
})
