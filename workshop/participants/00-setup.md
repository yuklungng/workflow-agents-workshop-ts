# 00 — Setup

> **Module 0 (~10 min).** Complete this before the first lab. The facilitator
> will walk through setup live, but finishing early means more time for coding.

This workshop starts on Render. Local development is available for tests,
debugging, and the worker ack exercise.

## Prerequisites

- A Render account (free tier works)
- A GitHub account (for forking the repo and connecting to Render)
- Node.js >= 22.12 (`node -v` to check; `nvm install 22` if needed)
- The Render CLI
- Optional: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for real model output

No LLM provider API key is required. With no provider key set, the agent uses a
deterministic mock model, so every deploy and test still works.

## 1. Fork and namespace the repo

Fork this repository into your own GitHub account. Then namespace the Render
Blueprints so your resource names don't collide with other attendees:

1. In your fork on GitHub, go to the **Actions** tab.
2. Find the **"Setup attendee Blueprint names"** workflow in the left sidebar.
3. Click **Run workflow** (use the default branch).

This runs `npm run setup`, which prefixes every Render resource name in the
three `render.yaml` Blueprint files with your GitHub username, then commits the
change back to your fork.

If you prefer to do it locally instead of through GitHub Actions:

```sh
git clone <your-fork-url>
cd workflow-agents-workshop
npm install
npm run setup
git add packages/*/render.yaml
git commit -m "Namespace Render resources"
git push
```

Either way, clone your fork afterward if you haven't already:

```sh
git clone <your-fork-url>
cd workflow-agents-workshop
npm install
```

Push any workshop edits back to your fork before deploying. Render builds from
your Git repository.

## 2. Install and log in with the Render CLI

Install the CLI if you do not already have it:

```sh
brew update && brew install render
```

Then log in and choose your active workspace:

```sh
render login
render workspace set
```

Check that the CLI can see your workspace:

```sh
render services --output json --confirm
```

The CLI is the main path for Pattern 3 and a useful inspection tool for every
pattern.

## 3. Connect Render to your Git provider

In the Render Dashboard, make sure your Git provider is connected and the forked
repo is visible. Patterns 1 and 2 deploy from Blueprints inside this repo:

- [`packages/naive-agent/render.yaml`](../../packages/naive-agent/render.yaml)
- [`packages/worker-agents/render.yaml`](../../packages/worker-agents/render.yaml)

Each Blueprint creates a Render project with a `production` environment, keeping
that pattern's services and datastores grouped together.

Pattern 3 uses a Blueprint for its web service and database, then the CLI for its
Workflow service.

## 4. Decide mock or real model output

For most workshops, start with the mock model. It removes LLM provider setup and
keeps the demo deterministic.

Use real model output only if you want live review text:

```sh
ANTHROPIC_API_KEY=...
# or
OPENAI_API_KEY=...
```

You can also force the mock even when a provider key exists:

```sh
AGENT_MODEL=mock
```

## 5. Prepare local test tools

Local setup is useful for tests and the Session 1 ack exercise.

Copy the root env example:

```sh
cp .env.example .env
```

Start local services only if you plan to run the apps on your machine:

```sh
createdb agents_workshop
redis-server &
```

`createdb` is for local Postgres. `redis-server` is for the worker-agents queue.
Render provisions managed Postgres and Key Value for the deployed versions.

## 6. Use a demo PR

Use one of these public PRs during the workshop:

- **Mastra frontend path:** `https://github.com/mastra-ai/mastra/pull/17704`
  - Small Playground UI fix touching `.tsx` files.
  - Good when you want the UX reviewer to join the fan-out.
- **LlamaIndex baseline:** `https://github.com/run-llama/LlamaIndexTS/pull/2234`
  - Small OpenAI provider fix.
  - Good for the first Pattern 1 run.
- **OpenAI Agents trace:** `https://github.com/openai/openai-agents-js/pull/1368`
  - Streaming/chat completions tracing fix.
  - Good for showing an agent SDK change after everyone has a working deploy.

For Pattern 1 and Pattern 2, you can paste this URL into the deployed web UI. For
Pattern 3, you can pass it as Workflow task input.

Next: [01 — Naive agent](01-naive-agent.md).
