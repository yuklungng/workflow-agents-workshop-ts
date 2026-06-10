/**
 * The agent loop — a minimal, dependency-free implementation. Pure over (model,
 * systemPrompt, tools, messages): it never branches on where a tool came from.
 * State lives in memory for the run; durability is the substrate's concern.
 */
import type {
  AgentInput,
  Budget,
  ContentBlock,
  Logger,
  Message,
  ModelClient,
  ModelSpec,
  Permissions,
  SamplingParams,
  SpanInfo,
  SpanKind,
  SpanOutcome,
  TokenUsage,
  Tool,
  ToolContext,
  ToolSchema,
  Tracer,
} from './types.js'

const DEFAULT_MAX_ITERATIONS = 50
const DEFAULT_MAX_TOKENS = 1_000_000

export interface RunLoopArgs {
  client: ModelClient
  model: ModelSpec
  systemPrompt: string
  tools: Tool[]
  input: AgentInput
  signal: AbortSignal
  logger: Logger
  env: (name: string) => string | undefined
  budget?: Budget
  permissions?: Permissions
  sampling?: SamplingParams
  tracer?: Tracer
  runId?: string
  parentSpanId?: string
}

export interface RunLoopResult {
  text: string
  usage: TokenUsage
  messages: Message[]
}

export async function runLoop(args: RunLoopArgs): Promise<RunLoopResult> {
  const { client, tools, logger, env } = args
  const maxIterations = args.budget?.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const maxTokens = args.budget?.maxTokens ?? DEFAULT_MAX_TOKENS
  const maxWallSeconds = args.budget?.maxWallSeconds
  const deadline = maxWallSeconds ? Date.now() + maxWallSeconds * 1000 : undefined

  // Combine the caller's abort signal with a wall-clock timeout so a hung model
  // call is actually interrupted mid-flight — not just noticed between iterations.
  // Without a budget the behavior is unchanged (just the caller's signal).
  const signal = maxWallSeconds
    ? AbortSignal.any([args.signal, AbortSignal.timeout(maxWallSeconds * 1000)])
    : args.signal

  const byName = new Map(tools.map((t) => [t.name, t]))
  const schemas = exposedSchemas(tools, args.permissions)
  const toolCtx: ToolContext = { env, signal, logger }
  const trace = makeTracer(args)

  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: inputToText(args.input) }] },
  ]
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }

  for (let iter = 0; iter < maxIterations; iter++) {
    throwIfAborted(signal)
    if (deadline && Date.now() > deadline) {
      throw new Error(`wall-clock budget exhausted (${maxWallSeconds}s)`)
    }
    if (usage.inputTokens + usage.outputTokens >= maxTokens) {
      throw new Error(`token budget exhausted (${maxTokens})`)
    }

    const turn = trace.start(args.parentSpanId, 'llm', 'llm', { iteration: iter })

    let res
    try {
      res = await client.complete({
        model: args.model,
        system: args.systemPrompt,
        tools: schemas,
        messages,
        ...(args.sampling ? { sampling: args.sampling } : {}),
        signal,
      })
    } catch (err) {
      trace.end(turn, { ok: false, error: err instanceof Error ? err.message : String(err) })
      throw err
    }

    usage.inputTokens += res.usage.inputTokens
    usage.outputTokens += res.usage.outputTokens
    messages.push({ role: 'assistant', content: res.content })

    const toolUses = res.content.filter(isToolUse)
    if (toolUses.length === 0) {
      trace.end(turn, { ok: true, output: { stopReason: res.stopReason, usage: res.usage, final: true } })
      return { text: textOf(res.content), usage, messages }
    }

    const results: ContentBlock[] = []
    for (const use of toolUses) {
      throwIfAborted(signal)
      const span = trace.start(turn?.spanId, use.name, 'tool', use.input)
      const block = await dispatch(use, byName, args.permissions, toolCtx, logger)
      trace.end(
        span,
        block.type === 'tool_result' && block.isError
          ? { ok: false, error: contentToText(block.content) }
          : { ok: true, output: block.type === 'tool_result' ? block.content : block },
      )
      results.push(block)
    }
    trace.end(turn, { ok: true, output: { stopReason: res.stopReason, tools: toolUses.length } })
    messages.push({ role: 'tool', content: results })
  }

  throw new Error(`maxIterations (${maxIterations}) reached without a final answer`)
}

function makeTracer(args: RunLoopArgs): {
  start(parent: string | undefined, name: string, kind: SpanKind, input: unknown): SpanInfo | undefined
  end(span: SpanInfo | undefined, outcome: SpanOutcome): void
} {
  const tracer = args.tracer
  const runId = args.runId
  if (!tracer || !runId) {
    return { start: () => undefined, end: () => {} }
  }
  return {
    start(parent, name, kind, input) {
      const span: SpanInfo = {
        spanId: globalThis.crypto.randomUUID(),
        ...(parent ? { parentSpanId: parent } : {}),
        runId,
        name,
        kind,
      }
      tracer.onStart(span, input)
      return span
    },
    end(span, outcome) {
      if (span) tracer.onEnd(span, outcome)
    },
  }
}

function contentToText(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

function exposedSchemas(tools: Tool[], perms?: Permissions): ToolSchema[] {
  return tools
    .filter((t) => isToolAllowed(t.name, perms))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}

function isToolAllowed(name: string, perms?: Permissions): boolean {
  if (perms?.deniedTools?.includes(name)) return false
  if (perms?.allowedTools && perms.allowedTools.length > 0 && !perms.allowedTools.includes(name)) {
    return false
  }
  return true
}

async function dispatch(
  use: Extract<ContentBlock, { type: 'tool_use' }>,
  byName: Map<string, Tool>,
  perms: Permissions | undefined,
  ctx: ToolContext,
  logger: Logger,
): Promise<ContentBlock> {
  const fail = (content: string): ContentBlock => ({
    type: 'tool_result',
    toolUseId: use.id,
    content,
    isError: true,
  })

  if (!isToolAllowed(use.name, perms)) return fail(`tool "${use.name}" is not permitted`)
  const tool = byName.get(use.name)
  if (!tool) return fail(`unknown tool "${use.name}"`)

  try {
    const result = await tool.invoke(use.input, ctx)
    return {
      type: 'tool_result',
      toolUseId: use.id,
      content: result.content,
      ...(result.isError ? { isError: true } : {}),
    }
  } catch (err) {
    logger.warn({ tool: use.name }, 'tool invocation threw')
    return fail(err instanceof Error ? err.message : String(err))
  }
}

function isToolUse(b: ContentBlock): b is Extract<ContentBlock, { type: 'tool_use' }> {
  return b.type === 'tool_use'
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

function inputToText(input: AgentInput): string {
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('aborted')
}
