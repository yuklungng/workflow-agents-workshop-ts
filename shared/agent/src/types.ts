/**
 * The type contracts for the shared agent core. Deliberately small: a
 * provider-agnostic model client, the message/content shapes the loop threads, a
 * tool contract, and a tracing contract for telemetry.
 */

// ── Model ────────────────────────────────────────────────────────────────────

export interface ModelSpec {
  provider: 'anthropic' | 'openai' | 'mock'
  /** e.g. "claude-sonnet-4-6" or "gpt-4o". */
  model: string
  /** Optional baseURL override (defaults per provider). */
  baseURL?: string
  /** Env var holding the API key. Defaults: ANTHROPIC_API_KEY / OPENAI_API_KEY. */
  apiKeyEnv?: string
}

export interface SamplingParams {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

/** Loop stop conditions. Unset fields fall back to runtime defaults. */
export interface Budget {
  maxIterations?: number
  maxTokens?: number
  maxWallSeconds?: number
}


export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export type MessageRole = 'user' | 'assistant' | 'tool'

export interface Message {
  role: MessageRole
  content: ContentBlock[]
}

/** The model-facing shape of a tool (no handler). */
export interface ToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface CompleteArgs {
  model: ModelSpec
  system: string
  tools: ToolSchema[]
  messages: Message[]
  sampling?: SamplingParams
  signal: AbortSignal
}

export interface CompleteResult {
  content: ContentBlock[]
  usage: TokenUsage
  stopReason: string
}

/** A provider adapter. The loop never talks to a vendor SDK directly. */
export interface ModelClient {
  complete(args: CompleteArgs): Promise<CompleteResult>
}

// ── Tools ────────────────────────────────────────────────────────────────────

export interface ToolContext {
  env(name: string): string | undefined
  readonly signal: AbortSignal
  readonly logger: Logger
}

export interface ToolResult {
  content: string
  isError?: boolean
}

export interface Tool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  invoke(input: unknown, ctx: ToolContext): Promise<ToolResult>
}

/** A connected source's tools plus the handle to tear the connection down. */
export interface ResolvedSource {
  readonly tools: Tool[]
  /** No-op for local tools; disconnects the client for MCP sources. */
  close(): Promise<void>
}

/**
 * A tool source with a lifecycle. A local tool is a degenerate source (it just
 * resolves to itself); an MCP server is a connection-bearing source that emits
 * many tools. Sources are connected inside `agent.run()` and closed afterward.
 */
export interface ToolSource {
  readonly id: string
  resolve(ctx: ToolContext): Promise<ResolvedSource>
}

/** Anything registerable in the tool registry: a plain tool or a source. */
export type RegistryEntry = Tool | ToolSource

export interface Permissions {
  allowedTools?: string[]
  deniedTools?: string[]
  requireApproval?: string[]
}

// ── Logging ──────────────────────────────────────────────────────────────────

export interface Logger {
  debug(meta: Record<string, unknown>, msg?: string): void
  info(meta: Record<string, unknown>, msg?: string): void
  warn(meta: Record<string, unknown>, msg?: string): void
  error(meta: Record<string, unknown>, msg?: string): void
}

// ── Tracing ──────────────────────────────────────────────────────────────────

export type SpanKind = 'agent' | 'llm' | 'tool'

export interface SpanInfo {
  spanId: string
  parentSpanId?: string
  runId: string
  name: string
  kind: SpanKind
}

export type SpanOutcome =
  | { ok: true; output: unknown }
  | { ok: false; error: string }

export interface Tracer {
  onStart(span: SpanInfo, input: unknown): void
  onEnd(span: SpanInfo, outcome: SpanOutcome): void
}

// ── Agents ───────────────────────────────────────────────────────────────────

/** Agent input is either a prompt string or a structured object. */
export type AgentInput = string | Record<string, unknown>

/**
 * A plain agent definition. No markdown, no frontmatter, no Render coupling —
 * just data. The substrate (in-process / worker / workflow) decides how to run it.
 */
export interface AgentDefinition {
  name: string
  model: ModelSpec
  systemPrompt: string
  /** Tool names resolved from the shared tool registry. */
  tools?: string[]
  budget?: Budget
  sampling?: SamplingParams
  permissions?: Permissions
}

export interface AgentResult {
  text: string
  usage: TokenUsage
}

/** Per-invocation context threaded into `agent.run()`. */
export interface RunContext {
  signal?: AbortSignal
  /** Optional telemetry sink. Spans attach to runId. */
  tracer?: Tracer
  runId?: string
  parentSpanId?: string
}

/**
 * A runnable agent: a definition plus a substrate-agnostic `run()` that executes
 * the loop in-process. naive-agent and worker-agents call `run()` directly;
 * workflow-agents wraps it in a Render `task()`. Build one with `defineAgent()`.
 */
export interface Agent extends AgentDefinition {
  run(input: AgentInput, ctx?: RunContext): Promise<AgentResult>
}
