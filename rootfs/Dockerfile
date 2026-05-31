# Sandbox rootfs (v0, flavor: base)
#
# See docs/sandbox-plan.md → "Rootfs composition (v0)". Bundles the two in-VM
# MCP servers + a Python runtime on debian-slim:
#
#   /opt/mcp/rust-mcp-filesystem   filesystem MCP (read/write/edit/list/search)
#   /opt/mcp/mcp-shell/            JS shell-exec MCP (one `bash` tool; covers Python)
#   python3                         invoked through mcp-shell in v0
#
# Architecture note (MCP-in-VM): the container is a long-lived, idle host. It
# does NOT run the MCP servers as foreground processes. Instead the harness's
# DockerBackend.connectMcp opens one stdio transport per server by running
# `docker exec <container> <server-cmd>` — the server's lifetime is the
# transport's lifetime. So the container's job at boot is only to (a) prepare
# /work and (b) stay alive. init.sh does exactly that. Stdout/stderr of the
# server processes flow over the docker-exec stdio pipe straight to the harness.

# ---- stage 1: lift the rust-mcp-filesystem binary from the pinned image ----
# Same digest the project already trusts (configs/custom-catalog.yaml). The
# binary is a statically-linked ELF, so it runs unmodified on debian/glibc.
FROM mcp/rust-mcp-filesystem@sha256:77a7f6f7a477bdec2c58696c76afda8e1f88d189f7c8b935d8dd9a00ee5780c5 AS fs-mcp

# ---- stage 2: the sandbox image ----
FROM node:22-bookworm-slim AS base

# Python 3 + a minimal toolchain. python3-venv/pip so the actor can install
# packages via `sandbox_bash`. curl/ca-certificates for file ingestion
# (curl/wget into /work) per the plan's "File ingestion in v0".
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        ca-certificates \
        curl \
        bash \
    && rm -rf /var/lib/apt/lists/*

# In-VM MCP servers live under /opt/mcp.
RUN mkdir -p /opt/mcp /work

# rust-mcp-filesystem (filesystem MCP).
COPY --from=fs-mcp /rust-mcp-filesystem /opt/mcp/rust-mcp-filesystem
RUN chmod +x /opt/mcp/rust-mcp-filesystem

# mcp-shell (JS shell-exec MCP). Install its prod deps in-image so it runs
# offline at exec time (no network needed once built).
COPY mcp-shell/package.json /opt/mcp/mcp-shell/package.json
WORKDIR /opt/mcp/mcp-shell
RUN npm install --omit=dev --no-audit --no-fund
COPY mcp-shell/server.mjs /opt/mcp/mcp-shell/server.mjs
RUN chmod +x /opt/mcp/mcp-shell/server.mjs

# init.sh keeps the container alive and prepares /work.
COPY init.sh /opt/mcp/init.sh
RUN chmod +x /opt/mcp/init.sh

ENV WORK_DIR=/work
WORKDIR /work

# Idle host: prepare /work, then block forever. MCP servers are spawned
# per-connection via `docker exec` (see connectMcp).
ENTRYPOINT ["/opt/mcp/init.sh"]
