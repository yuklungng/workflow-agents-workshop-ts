import { test } from 'node:test'
import assert from 'node:assert/strict'
import { task } from '@renderinc/sdk/workflows'
import { securityReviewer } from '@workshop/agent'
import { storeTracer } from '@workshop/db'

test('an agent wrapped in task() runs in-process outside a workflow context', async () => {
  const securityTask = task(
    { name: 'security' },
    async (input: { patches: Array<{ file: string; diff: string }> }, runId?: string) => {
      return securityReviewer.run(input, { tracer: storeTracer(), runId })
    },
  )
  assert.equal(typeof securityTask, 'function')

  const result = await securityTask({ patches: [{ file: 'a.ts', diff: '+x' }] })
  assert.equal(typeof result.text, 'string')
  assert.ok(result.text.length > 0)
  assert.equal(typeof result.usage.inputTokens, 'number')
})

test('an agent task accepts an optional runId for span correlation', async () => {
  const securityTask = task(
    { name: 'security' },
    async (input: { patches: Array<{ file: string; diff: string }> }, runId?: string) => {
      return securityReviewer.run(input, { tracer: storeTracer(), runId })
    },
  )
  const result = await securityTask({ patches: [{ file: 'a.ts', diff: '+x' }] }, 'test-run-id')
  assert.equal(typeof result.text, 'string')
})
