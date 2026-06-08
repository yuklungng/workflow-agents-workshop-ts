/**
 * @workshop/agent — the shared core that all three patterns reuse unchanged.
 *
 * Agents are plain data wrapped by `defineAgent` into objects with an in-process
 * `.run()`. Tools (and optional MCP servers) live in `tools/` and are
 * auto-discovered. The substrate decides how `.run()` is invoked — naive-agent
 * (in-process), worker-agents (queue worker), or workflow-agents (Render task) —
 * and the agent code never changes between them.
 */

export { runReview, parseDecision, sumUsage, toReviewSummary } from './review.js'
export type {
  ReviewEvent,
  ReviewResult,
  ReviewSummary,
  ReviewFinding,
  ReviewDecision,
  RunReviewOptions,
} from './review.js'

export { defineAgent } from './agent.js'
export {
  REVIEWERS,
  AGENTS,
  securityReviewer,
  performanceReviewer,
  uxReviewer,
  judge,
  hasFrontendFiles,
  selectReviewers,
} from './agents.js'

export { prepareDiff } from './prepareDiff.js'
export type { Patch, PullRequest } from './prepareDiff.js'

export { filterDiff } from './filterDiff.js'
export type { FilterDiffOptions, FilterDiffResult } from './filterDiff.js'

// Tools + MCP: drop a file in src/tools/ (auto-discovered) or registerTool().
export { defineTool, defineMcpSource } from './tools/tool.js'
export type { McpSourceSpec } from './tools/tool.js'
export { getToolRegistry, registerTool, resolveTools } from './tool-registry.js'
export { loadTools } from './tools/loader.js'

export { runLoop } from './loop.js'
export type { RunLoopArgs, RunLoopResult } from './loop.js'

export { resolveClient } from './model.js'
export { MODEL_TIERS, resolveModelSpec } from './model-tiers.js'
export type { ModelTier } from './model-tiers.js'

export { createLogger } from './logger.js'

export type * from './types.js'
