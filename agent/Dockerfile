# The Linux agent's container image (ADR-0057 Decision 2 step 5), built for linux/amd64 and linux/arm64 by
# .github/workflows/agent-release.yml. Only the bundled agent.cjs: no node_modules, no source, no secrets.
#
# State lives in /var/lib/satis-agent (SD_AGENT_HOME), a volume owned by the unprivileged `node` user. Run it with the
# game server on the same host (host networking or the game's network), e.g.
#   docker run -d --name satis-agent --restart unless-stopped -v satis-agent-state:/var/lib/satis-agent \
#     ghcr.io/sour-dev-home/satisfactory-dash-agent@sha256:<digest>
# Pin by digest and update on purpose; never auto-pull (runbooks/agent-linux.md).

# Build stage: runs on the BUILD machine's platform, so the arm64 image never runs npm ci or esbuild under emulation.
FROM --platform=$BUILDPLATFORM node:26-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/game-adapter/package.json packages/game-adapter/package.json
COPY agent/package.json agent/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY packages/game-adapter packages/game-adapter
COPY agent agent
RUN npm run build -w agent

FROM node:26-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS runtime
WORKDIR /app
COPY --from=build /repo/agent/dist/agent.cjs ./agent.cjs
RUN install -d -o node -g node -m 700 /var/lib/satis-agent
ENV NODE_ENV=production
ENV SD_AGENT_HOME=/var/lib/satis-agent
VOLUME /var/lib/satis-agent
USER node
ENTRYPOINT ["node", "agent.cjs"]
CMD ["run"]
