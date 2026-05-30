# syntax=docker/dockerfile:1.6
#
# Multi-stage build for the SJMS 2.5 API server.
#
# Build context MUST be the repository root (not ./server) so this Dockerfile
# can access the Prisma schema at /prisma/schema.prisma and the npm workspaces
# manifest at /package.json. docker-compose.yml sets context: . accordingly.

# ─── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Native-module build toolchain. The server's `re2` dependency
# (server/package.json) has hasInstallScript: true and ships no
# musl prebuild, so `npm ci` must compile it from source — which
# needs python3 + a C++ toolchain. Without these, the build fails
# at `npm ci` with "gyp ERR! find Python" and "g++: not found",
# which is what the Trivy — API image container-scan job hits.
RUN apk add --no-cache python3 make g++

# Copy workspace manifests first so the npm install layer caches when only
# source changes (not dependencies).
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install ALL dependencies including devDependencies (needed for tsc + prisma CLI).
RUN npm ci

# Copy schema + server source + tsconfig.
COPY prisma ./prisma
COPY tsconfig.json ./
COPY server ./server

# Generate the Prisma client into node_modules/.prisma + node_modules/@prisma.
RUN npx prisma generate --schema=prisma/schema.prisma

# Compile TypeScript → server/dist.
RUN npm run build --workspace=server

# ─── Stage 2: production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace manifests and install production dependencies only.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# Same toolchain rationale as the builder stage — re2's install script
# runs during `npm ci` here too (production deps include re2). Install
# the toolchain, run npm ci, then `apk del` it in the same layer so the
# final image stays lean (build tools are not present at runtime).
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev --workspace=server --include-workspace-root \
    && apk del .build-deps

# Copy the compiled dist, the generated Prisma client, and the schema
# (runtime needs the schema so Prisma can introspect enum types).
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

WORKDIR /app/server

EXPOSE 3001

CMD ["node", "dist/index.js"]
