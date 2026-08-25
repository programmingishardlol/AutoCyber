# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.23.2

FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS dependencies

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/remediation/package.json packages/remediation/package.json
COPY packages/sandbox/package.json packages/sandbox/package.json
COPY packages/scanner/package.json packages/scanner/package.json
COPY packages/security-memory/package.json packages/security-memory/package.json
COPY packages/workflows/package.json packages/workflows/package.json

RUN pnpm install --frozen-lockfile

FROM base AS builder

WORKDIR /workspace

COPY --from=dependencies /workspace/ ./
COPY . .

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

RUN pnpm --filter @autocyber/web build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV SCANNER_WORKDIR=/tmp/autocyber-scans

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app /tmp/autocyber-scans \
  && chown -R node:node /app /tmp/autocyber-scans

WORKDIR /app

COPY --from=builder --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /workspace/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/web/server.js"]
