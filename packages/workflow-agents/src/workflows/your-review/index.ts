/**
 * YOUR REVIEW — a sandbox workflow.
 *
 * This folder is *yours* to experiment with. Drop it under `workflows/<name>/`
 * and `loader.ts` auto-discovers it as the `your-review` workflow — no
 * registration step. Run it, break it, extend it, compare traces against the
 * finished `code-review` workflow next door.
 *
 * The starter below fetches a PR diff and returns a lightweight overview. From
 * here, go wherever curiosity takes you — compose agents, fan out reviewers,
 * add filtering, wire a judge, throw on purpose to watch retries. See
 * docs/04-author-a-task.md for ideas and a worked example.
 */
import { task } from "@renderinc/sdk/workflows";
import { filterDiff, prepareDiff, type Patch } from "@workshop/agent";

interface YourReviewInput {
  url: string;
  /** Break-glass: include lock files and other noise in the diff. */
  breakGlass?: boolean;
}

function overview(patches: Patch[]) {
  const totalDiffLines = patches.reduce((n, p) => n + p.diff.split("\n").length, 0);
  return {
    fileCount: patches.length,
    totalDiffLines,
    largestFiles: [...patches]
      .sort((a, b) => b.diff.length - a.diff.length)
      .slice(0, 5)
      .map((p) => ({ file: p.file, diffLines: p.diff.split("\n").length })),
  };
}

function extensions(patches: Patch[]) {
  const counts = new Map<string, number>();
  for (const { file } of patches) {
    const ext = file.includes(".") ? (file.split(".").pop() ?? "(none)") : "(none)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

export default task(
  {
    name: "your-review",
    timeoutSeconds: 120,
    retry: { maxRetries: 2, waitDurationMs: 1000, backoffScaling: 2 },
  },
  async function yourReview(input: YourReviewInput) {
    const allPatches = await prepareDiff({ url: input.url, labels: [] });
    const filtered = filterDiff(allPatches, input.breakGlass ? { breakGlass: true } : {});

    // Everything below is a starting point — replace, extend, or delete freely.
    return {
      url: input.url,
      overview: overview(filtered.patches),
      extensions: extensions(filtered.patches),
      dropped: filtered.dropped,
      breakGlass: filtered.breakGlass,
    };
  },
);

// ── Ideas to explore ────────────────────────────────────────────────────────
//
// Compose a single agent as its own task (inline — no wrapper needed):
//
//   import { task } from "@renderinc/sdk/workflows";
//   import { securityReviewer } from "@workshop/agent";
//   import { storeTracer } from "@workshop/db";
//
//   const securityTask = task(
//     { name: "security", timeoutSeconds: 120 },
//     async (input: { patches: Patch[] }, runId?: string) => {
//       return securityReviewer.run(input, { tracer: storeTracer(), runId });
//     },
//   );
//   const review = await securityTask({ patches: filtered.patches });
//
// Fan out all always-on reviewers:
//
//   import { REVIEWERS } from "@workshop/agent";
//   const reviews = await Promise.all(
//     REVIEWERS.map((agent) =>
//       task(
//         { name: agent.name },
//         async (input: { patches: Patch[] }) => agent.run(input, { tracer: storeTracer() }),
//       )({ patches: filtered.patches }),
//     ),
//   );
//
// Add a verdict with the judge (see code-review/index.ts for the full pipeline).
//
// Force a flaky failure to watch Render retry in a fresh instance:
//
//   if (Math.random() < 0.5) throw new Error("flaky!");
//
// Drop a new tool in shared/agent/src/tools/ and give an agent access to it.
// ───────────────────────────────────────────────────────────────────────────
