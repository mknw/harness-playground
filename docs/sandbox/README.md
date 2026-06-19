# Sandbox debugging

Quick reference for observing what's happening inside the compute sandbox
([#79](https://github.com/mknw/harness-playground/issues/79)) at runtime:
what containers exist, what's running inside them, how to peek, and how to
clean up. Pairs with the design spec at [`docs/sandbox-plan.md`](../sandbox-plan.md).

## How to identify sandbox containers

Every sandbox container carries two labels (set in
[`ui/src/lib/sandbox/docker-backend.server.ts`](../../ui/src/lib/sandbox/docker-backend.server.ts)):

| Label                    | Value                       | Purpose                                          |
|--------------------------|-----------------------------|--------------------------------------------------|
| `kg-sandbox=1`           | always `1`                  | The family label — use for filters and reaping.  |
| `kg-sandbox-id=<sbx-…>`  | the harness's sandbox id    | Same string as the Docker container name.        |

The container name (`sbx-XXXXXXXX`) is the harness's stable id. For id-keyed
attachments (`withSandbox({ id: sessionId })`), this id stays the same across
the conversation's turns — the container *underneath* may change after a
warm-pool `reset`, but the id you see in the UI's terminal prompt is stable.

## See what's running

```sh
# Snapshot: name, status, age
docker ps --filter label=kg-sandbox=1 --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}'

# Live-updating (refreshes every 2s; Ctrl-C to exit)
watch -n 2 'docker ps --filter label=kg-sandbox=1 --format "table {{.Names}}\t{{.Status}}"'

# Resource usage (CPU, memory, I/O) — live
docker stats --filter label=kg-sandbox=1

# Include stopped ones too (useful when debugging crashes; --rm normally
# cleans up on stop, but a fast-crashing one may still be listed briefly)
docker ps -a --filter label=kg-sandbox=1
```

## Peek inside one

```sh
# Replace sbx-xxxx with a name from `docker ps` above.
docker exec -it sbx-xxxx bash      # interactive shell — same thing the UI's
                                    # Terminal tab → Shell gives you, just from
                                    # the host CLI.
docker exec sbx-xxxx ls -la /work  # inspect the agent's workspace
docker exec sbx-xxxx ps -ef        # processes inside the VM
docker logs sbx-xxxx               # mostly empty (idle host); useful only if
                                    # mcp-shell or init.sh wrote to stderr.
```

The `/work` directory is the agent's workspace — files written via
`sandbox_write` / `sandbox_edit` land here, the shell's `cwd` defaults here.
Inspecting it is the fastest way to confirm "did the agent actually write
what it claimed to write?".

## Reap leftovers

The harness calls `--rm` so a stop auto-removes, and on graceful shutdown the
warm pool destroys everything. **Crashes or kill -9 can leave orphans.**

```sh
# Nuke every sandbox container (running or stopped):
docker ps -a --filter label=kg-sandbox=1 -q | xargs -r docker rm -f
```

Safe by construction — only touches `kg-sandbox=1`-labelled containers, never
anything else. Same command is in
[`ui/src/lib/sandbox/scripts/README.md`](../../ui/src/lib/sandbox/scripts/README.md).

## What you'll see in practice

| Pattern                           | Container shape                                                       |
|-----------------------------------|-----------------------------------------------------------------------|
| `withSandbox({})` (anonymous)     | Boots a VM for the turn, releases back to the warm pool (cap `base:1`). |
| `withSandbox({ id })` (session)   | Boots a VM for the chat, parked under the id between turns.           |
| Interactive Shell (Terminal tab)  | No extra container — attaches to the *session's* VM via `docker exec -it`. |
| `withSandbox({ fresh: true })`    | One-shot private VM, destroyed on exit (skips pool).                  |

After light use you'll typically see **0 or 1 anonymous warm-pool VM** plus
**one VM per active session id**. The lazy idle sweep destroys parked entries
~5 min after last use, but only fires on the next sandbox action — see issue
[#82](https://github.com/mknw/harness-playground/issues/82) for the
timer-driven follow-up if dormant accumulation becomes an issue.

## Inspecting an agent run after the fact

Per-conversation context logs land under `.harness-logs/`:

```
.harness-logs/context-<sessionId>-<date>.json
```

Each is the full `UnifiedContext` for one turn — `events[]` is the timeline
(user_message, controller_action, tool_call, tool_result, critic_result,
pattern_enter/exit, error, assistant_message). Replay it with `jq` for a
compact trace:

```sh
LOG=.harness-logs/context-XXXX.json
jq -r '.events[] | [.ts, .type, .patternId, (.data.action.tool_name // .data.tool // "")] | @tsv' "$LOG"
```

Useful follow-up filters:

```sh
# Just the tool calls and what was sent / returned
jq -r '.events[] | select(.type=="tool_call" or .type=="tool_result")' "$LOG"

# Critic feedback (why the loop didn't accept)
jq -r '.events[] | select(.type=="critic_result") | .data.result.explanation' "$LOG"

# Errors only
jq -r '.events[] | select(.type=="error") | .data.error' "$LOG"
```

## What's *not* observable today

- **No in-UI fleet view.** The Terminal tab shows the *current session's*
  activity and shell — there's no harness-wide "which sandboxes are running"
  panel. Use the `docker ps` snippets above.
- **No per-VM stdout history outside the agent's view.** The interactive
  Shell has a 64KB scrollback while it's open; once disposed, the bytes are
  gone. The agent's `tool_result` events are persisted in the conversation log
  and survive process restart.
- **`docker logs <sbx-…>` is usually empty.** Sandboxes are idle hosts; the
  in-VM MCP servers and the shell stream their stdio over `docker exec`, not
  over the container's main stdout.

## Related docs

- [`docs/sandbox-plan.md`](../sandbox-plan.md) — full design spec (process
  topology, attachment model, MCP-in-VM architecture, ALS dispatch, backend
  interface, build order).
- [`rootfs/README.md`](../../rootfs/README.md) — how the `kg-sandbox:base`
  image is built and what's inside.
- [`ui/src/lib/sandbox/scripts/README.md`](../../ui/src/lib/sandbox/scripts/README.md)
  — LLM-free and real-LLM live-container smoke scripts (`smoke-scripted.ts`,
  `smoke-llm.ts`).
- [`ui/src/lib/harness-patterns/README.md`](../../ui/src/lib/harness-patterns/README.md)
  — harness patterns overview (event types, EventView, trackEvent).
