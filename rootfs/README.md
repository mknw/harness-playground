# Sandbox rootfs (`base` flavor, v0)

The image definition for sandbox VMs. See [`docs/sandbox-plan.md`](../docs/sandbox-plan.md)
→ "Rootfs composition (v0)" for the design. This is the only "code at the
project root" the sandbox needs — there is no separate pool-manager daemon.

## Contents

| Path (in image) | What | Notes |
|-----------------|------|-------|
| `/opt/mcp/rust-mcp-filesystem` | Filesystem MCP server | Lifted from the pinned `mcp/rust-mcp-filesystem` image (same digest as `configs/custom-catalog.yaml`); statically linked, runs on debian. |
| `/opt/mcp/mcp-shell/` | JS shell-exec MCP server (one `bash` tool) | Authored here (`mcp-shell/`); deps installed in-image. Covers Python via `python3 -c …`. |
| `python3`, `pip`, `venv` | Python runtime | Invoked through `mcp-shell` in v0. |
| `/work` | Agent working directory | The filesystem MCP is scoped to this; shell `cwd` defaults here. |
| `/opt/mcp/init.sh` | Entry/launcher | Idle-host entrypoint + `serve <name>` launch path for `docker exec`. |

## Architecture: MCP-in-VM (Docker model)

The container is a **long-lived idle host**. It does *not* run the MCP servers
as foreground services. The harness's `DockerBackend.connectMcp` opens one
stdio transport per server by running:

```
docker exec -i <container> /opt/mcp/init.sh serve filesystem
docker exec -i <container> /opt/mcp/init.sh serve shell
```

Each server's lifetime is the transport's lifetime. Stdout/stderr flow over the
docker-exec stdio pipe straight to the harness. No port mapping, no host
gateway involvement.

## Build

```sh
docker build -t kg-sandbox:base rootfs/
```

The build is a two-stage Dockerfile:
1. lift the `rust-mcp-filesystem` binary from its pinned image, then
2. assemble `node:22-bookworm-slim` + python3 + the two MCP servers.

### Inside the nix shell

The repo's `flake.nix` shellHook sets `DOCKER_CONFIG=$PWD/.docker` so the
nix-store-backed CLI plugins (`docker-mcp`, eventually `docker-model`) are
picked up. Naively that breaks `docker build` / `docker run`, because the
worktree-local `.docker/contexts/` is empty and the active context (typically
`colima` on macOS) can't resolve its endpoint metadata:

```
context "colima": context not found: open .docker/contexts/meta/<hash>/meta.json
```

The shellHook bridges this by symlinking `~/.docker/contexts` into
`$DOCKER_CONFIG/contexts`. Re-enter the nix shell after pulling this change.
If you ever see the error above and the symlink is missing, run:

```sh
ln -sfn "$HOME/.docker/contexts" "$DOCKER_CONFIG/contexts"
```

…or as a one-off, drop the env entirely: `env -u DOCKER_CONFIG docker build ...`.
The same applies at runtime — `DockerBackend` shells out to `docker run`, so
`pnpm dev:exposed` from inside the nix shell relies on the same bridge.

## Verify both MCP servers come up on stdio

Start an idle container:

```sh
CID=$(docker run -d --rm kg-sandbox:base)
```

Filesystem MCP — `initialize` + `tools/list`:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| docker exec -i "$CID" /opt/mcp/init.sh serve filesystem
# → serverInfo rust-mcp-filesystem; tools/list includes read_text_file, write_file, …
```

Shell MCP — handshake + a `bash` call (also exercises Python word-count):

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"bash","arguments":{"command":"python3 -c \"print(len('one two three'.split()))\""}}}' \
| docker exec -i "$CID" /opt/mcp/init.sh serve shell
# → serverInfo mcp-shell; bash returns {"stdout":"3\n","exit_code":0,...}

docker stop "$CID"
```

## Tool surface exposed to the actor

The harness applies a `sandbox_` prefix when registering these (see plan
→ "Tools available in v0"): `sandbox_read`, `sandbox_write`, `sandbox_edit`,
`sandbox_list`, `sandbox_search` (filesystem) and `sandbox_bash` (shell).

## Not in v0

- Publishing to a registry (built locally for dev; image-publish is an ops step).
- Heavier flavors (Polars / PyPDF / spaCy / sentence-transformers) — the v1
  rootfs catalog ([#78](https://github.com/mknw/harness-playground/issues/78)).
- A Rust shell-exec server (swaps in for `mcp-shell` only if cold-start is felt).
