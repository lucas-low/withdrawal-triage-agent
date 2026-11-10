FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/triage.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY data ./data
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/cli/index.ts", "serve"]
