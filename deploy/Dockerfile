# Build from the repo root:  docker build -f deploy/Dockerfile -t car-record .
# Plain HTTP on $PORT. HTTPS / external access is handled outside this container.
# Needs DATABASE_URL (an existing Postgres).

# ---- build ---------------------------------------------------------------
# The build output is plain JS (no native modules), so it always runs on the build
# machine's own platform; only the small runtime stage is per target platform.
FROM --platform=$BUILDPLATFORM node:22-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.18.0

# Install deps first (better layer caching).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- runtime -------------------------------------------------------------
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public
WORKDIR /app

# The server bundle includes all npm deps (incl. the pure-JS pg driver); only Node built-ins are needed at runtime.
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./public

USER node
EXPOSE 8080

# /healthz also pings Postgres (503 while the database is unreachable).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
