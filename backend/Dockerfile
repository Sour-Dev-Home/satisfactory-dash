# Build stage: install workspace deps and bundle the backend into one file.
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/game-adapter/package.json packages/game-adapter/package.json
COPY backend/package.json backend/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY packages/game-adapter packages/game-adapter
COPY backend backend
RUN npm run build -w backend

# Runtime stage: just the bundled output, no node_modules, no source.
FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /repo/backend/dist/server.cjs ./server.cjs
ENV NODE_ENV=production
# Inside a container, loopback is private to the container, so listen on all of its
# interfaces; what's reachable from outside is decided by the port mapping. Outside a
# container the backend defaults to 127.0.0.1 (ADR-0013).
# WARNING: in a container, the tunnel/proxy does NOT connect from loopback, so
# routes/clientIp.ts ignores CF-Connecting-IP and every visitor shares one IP for the
# login lockout (one attacker could lock everyone out). ADR-0013 runs the backend
# directly on the game-server PC; before running it in a container, add an explicit
# trusted-proxy setting (found by PR #25's fresh-eyes review).
ENV HOST=0.0.0.0
EXPOSE 3001
CMD ["node", "server.cjs"]
