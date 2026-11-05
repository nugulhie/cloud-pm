# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Build tooling stays in the build stages.
FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM dependencies AS build
ENV NEXT_STANDALONE=true
COPY . .
RUN mkdir -p public && npm run build

# The TypeScript worker needs tsx at runtime, but not test or typecheck tools.
FROM base AS production-dependencies
COPY package.json package-lock.json ./
# Remove dev declarations so Next's optional test peer is not installed.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm pkg delete devDependencies \
    && npm ci --omit=dev --omit=peer

FROM base AS runtime
ENV NODE_ENV=production
RUN mkdir -p .data && chown node:node .data
USER node

FROM runtime AS worker
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package.json ./
COPY --chown=node:node src ./src
CMD ["node", "--import", "tsx", "src/worker.ts"]

# Keep web last so docker build . still produces the web server.
FROM runtime AS web
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
