/**
 * Wrap a shared Agent as a Render Workflow task.
 *
 * This is the *entire* difference between workflow-agents and naive-agent/worker-agents: instead
 * of calling `agent.run(input)` in-process, we register `agent.run` as a
 * `task()`. Each call then runs in its own isolated Render instance with
 * per-task retries, timeouts, and traces — for free.
 *
 * Agent spans are written to the shared telemetry store (@workshop/db) via
 * storeTracer — the same store the telemetry viewer reads — so a run's spans
 * show up alongside its findings when a runId is provided.
 *
 * Invoke as `task(agentInput)` or `task(agentInput, runId)` — the optional runId
 * links spans to a review row in the telemetry viewer (used by code-review from
 * the gateway; CLI sandbox runs omit it).
 */
import { task } from "@renderinc/sdk/workflows";
import type { TaskFunction } from "@renderinc/sdk/workflows";
import { storeTracer } from "@workshop/db";
import type { Agent, AgentInput, AgentResult } from "@workshop/agent";

export type AgentTaskRun = TaskFunction<[input: AgentInput, runId?: string], AgentResult>;

export function agentTask(agent: Agent): AgentTaskRun {
  return task(
    {
      name: agent.name,
      ...(agent.budget?.maxWallSeconds ? { timeoutSeconds: agent.budget.maxWallSeconds } : {}),
    },
    async function agentRun(input: AgentInput, runId?: string): Promise<AgentResult> {
      // Each task runs in its own (possibly short-lived) container, so flush span
      // writes before returning — otherwise the instance can be deprovisioned
      // before the best-effort writes land.
      const tracer = storeTracer();
      try {
        return await agent.run(input, {
          tracer,
          ...(runId ? { runId } : {}),
        });
      } finally {
        await tracer.flush();
      }
    },
  );
}
