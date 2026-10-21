# Two images from one file (ADR-0034, #404), built for linux/amd64 and linux/arm64:
#   runtime  the app: only the bundled server.cjs, no node_modules, no source.
#   ops      the one-off jobs (npm run db:init / db:migrate / backup -w backend), run by command, e.g.
#            docker run --rm -e MIGRATOR_DATABASE_URL ... <ops image> npm run db:migrate -w backend
#            The backup (#407) needs pg_dump, age and the AWS CLI (its uploader, also for Backblaze B2
#            through BACKUP_S3_ENDPOINT); compose.yaml's `backup` service runs it.
#
# TLS to Amazon RDS: both images carry the RDS global CA bundle (backend/rds-global-bundle.pem) at
#   /etc/ssl/rds/global-bundle.pem
# so a database URL verifies the server with
#   ?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem

# Build stage: install workspace deps and bundle the backend into one file. It runs on the BUILD
# machine's platform, so the arm64 image never runs npm ci or esbuild under emulation.
FROM --platform=$BUILDPLATFORM node:22-slim@sha256:a6385bc33f0f9d6a08482c87f52baee537a9184e2b47dea1ed97caac62f8960c AS build
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

# The ops image's node_modules, still on the build platform: reinstalled with the TARGET's native
# binaries (tsx runs on esbuild, whose binary is per CPU). --ignore-scripts, because nothing built
# for the target can run here; nothing the ops scripts load needs an install script.
FROM build AS ops-deps
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) cpu=x64 ;; \
      arm64) cpu=arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && npm ci --os=linux --cpu="$cpu" --ignore-scripts

# Ops image: the build stage's tsx scripts and backend/migrations, plus the tools the scripts call:
# the PostgreSQL 18 client (pg_dump), age and the AWS CLI (backup). Only the paths the scripts need
# are copied, never the whole backend directory, so a local backend/.env can't end up in the image.
FROM node:22-slim@sha256:a6385bc33f0f9d6a08482c87f52baee537a9184e2b47dea1ed97caac62f8960c AS ops
# The PGDG signing key, pinned by hash: a changed key fails the build instead of being trusted.
ARG PGDG_ASC_SHA256=0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "$PGDG_ASC_SHA256  /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc" | sha256sum -c - \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 age awscli \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
COPY backend/rds-global-bundle.pem /etc/ssl/rds/global-bundle.pem
WORKDIR /repo
COPY --from=ops-deps /repo/package.json /repo/package-lock.json ./
COPY --from=ops-deps /repo/node_modules node_modules
COPY --from=ops-deps /repo/packages/shared packages/shared
COPY --from=ops-deps /repo/packages/game-adapter packages/game-adapter
COPY --from=ops-deps /repo/backend/package.json /repo/backend/tsconfig.json backend/
COPY --from=ops-deps /repo/backend/node_modules backend/node_modules
COPY --from=ops-deps /repo/backend/scripts backend/scripts
COPY --from=ops-deps /repo/backend/src backend/src
COPY --from=ops-deps /repo/backend/migrations backend/migrations
# The backup's local encrypted copies (BACKUP_LOCAL_DIR in compose.yaml's backup service), owned by the
# node user: a named volume mounted here starts with this ownership, so the job can write to it.
RUN install -d -o node -g node -m 700 /var/backups/satis
ENV NODE_ENV=production
USER node
# No default job: running the image bare lists the scripts it can run.
CMD ["npm", "run", "-w", "backend"]

# Runtime stage: just the bundled output, no node_modules, no source.
FROM node:22-slim@sha256:a6385bc33f0f9d6a08482c87f52baee537a9184e2b47dea1ed97caac62f8960c AS runtime
WORKDIR /app
COPY backend/rds-global-bundle.pem /etc/ssl/rds/global-bundle.pem
COPY --from=build /repo/backend/dist/server.cjs ./server.cjs
ENV NODE_ENV=production
# Loopback only, the same fail-safe default as outside a container (ADR-0013). The tunnel reaches it
# because cloudflared shares the backend's network namespace: one Fargate task in awsvpc mode, or
# network_mode: "service:backend" in compose. Then cloudflared connects from 127.0.0.1, which is the
# one peer platform/clientIp.ts trusts for CF-Connecting-IP, so each visitor keeps their own IP for
# the login lockout. Never publish the port or give cloudflared its own network: from any other peer
# clientIp.ts ignores the header and every visitor would share one IP. Set HOST=0.0.0.0 only where
# no tunnel is involved (the CI smoke test).
ENV HOST=127.0.0.1
EXPOSE 3001
USER node
CMD ["node", "server.cjs"]
