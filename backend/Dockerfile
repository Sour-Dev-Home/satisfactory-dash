# Build stage: install workspace deps and bundle the backend into one file.
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY backend/package.json backend/package.json
RUN npm ci
COPY packages/shared packages/shared
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
ENV HOST=0.0.0.0
EXPOSE 3001
CMD ["node", "server.cjs"]
