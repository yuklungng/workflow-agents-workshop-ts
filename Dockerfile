FROM node:22-bookworm-slim

WORKDIR /app

# Render CLI — used by Pattern 3 Docker (`render workflows dev`).
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates unzip \
  && curl -fsSL https://raw.githubusercontent.com/render-oss/cli/main/bin/install.sh | sh \
  && apt-get purge -y unzip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.local/bin:/root/.render/bin:${PATH}"

# Install workspace dependencies (cached layer).
COPY package.json package-lock.json ./
COPY shared/agent/package.json shared/agent/
COPY shared/db/package.json shared/db/
COPY shared/ui/package.json shared/ui/
COPY packages/naive-agent/package.json packages/naive-agent/
COPY packages/worker-agents/package.json packages/worker-agents/
COPY packages/workflow-agents/package.json packages/workflow-agents/

RUN npm ci

COPY . .

RUN chmod +x scripts/docker-workflow-dev.sh

ENV NODE_ENV=development
