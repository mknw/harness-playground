#!/usr/bin/env node
/**
 * mcp-shell — minimal stdio MCP server exposing a single `bash` tool.
 *
 * Part of the sandbox rootfs (see docs/sandbox-plan.md → "Rootfs composition").
 * Runs *inside* the sandbox VM/container; the harness reaches it over the
 * tunneled stdio transport that `DockerBackend.connectMcp` opens. This is the
 * v0 shell surface — it covers Python too, via `python3 -c "..."` or scripts
 * written to /work and then executed.
 *
 * Deliberately tiny and dependency-light (just the MCP SDK + zod). A Rust
 * shell-exec server is a v1 swap if cold-start ever becomes felt; until then
 * JS is fine because cold-start is amortized per-VM-boot by the warm pool,
 * not paid per tool call.
 *
 * Tool surface:
 *   bash(command, cwd?, timeout_ms?) ->
 *     { stdout, stderr, exit_code, timed_out }
 *
 * Defaults: cwd = WORK_DIR env (or /work), timeout = SHELL_TIMEOUT_MS env
 * (or 60_000ms). The command runs through `/bin/bash -lc` so shell builtins,
 * pipes, and `&&` work as the actor expects.
 */

import { spawn } from 'node:child_process'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const DEFAULT_CWD = process.env.WORK_DIR || '/work'
const DEFAULT_TIMEOUT_MS = Number(process.env.SHELL_TIMEOUT_MS || 60_000)
const MAX_OUTPUT_BYTES = Number(process.env.SHELL_MAX_OUTPUT_BYTES || 1_000_000)

/**
 * Run a shell command, capturing stdout/stderr with a wall-clock timeout.
 * Never throws for command-level failure — a non-zero exit is reported as
 * data (exit_code), matching the failure-mode table in the sandbox plan
 * ("Script bug → tool_result with non-zero exit + stderr").
 */
function runBash(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let settled = false

    const append = (buf, which) => {
      const text = buf.toString('utf8')
      if (which === 'out') {
        if (stdout.length + text.length > MAX_OUTPUT_BYTES) {
          stdout += text.slice(0, Math.max(0, MAX_OUTPUT_BYTES - stdout.length))
          stdoutTruncated = true
        } else {
          stdout += text
        }
      } else {
        if (stderr.length + text.length > MAX_OUTPUT_BYTES) {
          stderr += text.slice(0, Math.max(0, MAX_OUTPUT_BYTES - stderr.length))
          stderrTruncated = true
        } else {
          stderr += text
        }
      }
    }

    child.stdout.on('data', (b) => append(b, 'out'))
    child.stderr.on('data', (b) => append(b, 'err'))

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const finish = (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (stdoutTruncated) stdout += '\n…[stdout truncated]'
      if (stderrTruncated) stderr += '\n…[stderr truncated]'
      resolve({
        stdout,
        stderr,
        exit_code: exitCode,
        timed_out: timedOut,
      })
    }

    child.on('error', (err) => {
      stderr += `\n[mcp-shell] spawn error: ${err instanceof Error ? err.message : String(err)}`
      finish(-1)
    })
    child.on('close', (code, signal) => {
      // SIGKILL from our timeout surfaces as null code + signal; report 124
      // (the conventional timeout exit code) so the actor reads it cleanly.
      finish(timedOut ? 124 : code ?? (signal ? 137 : 0))
    })
  })
}

const server = new McpServer({ name: 'mcp-shell', version: '0.1.0' })

server.registerTool(
  'bash',
  {
    description:
      'Run a shell command inside the sandbox via `bash -lc`. Use for Python ' +
      '(`python3 -c "..."` or run a script written to /work), package installs, ' +
      'file inspection, and any other shell work. Returns stdout, stderr, the ' +
      'exit code, and whether it timed out. Working directory defaults to /work.',
    inputSchema: {
      command: z.string().describe('The shell command to execute (passed to bash -lc).'),
      cwd: z
        .string()
        .optional()
        .describe(`Working directory. Defaults to ${DEFAULT_CWD}.`),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(`Wall-clock timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}.`),
    },
  },
  async ({ command, cwd, timeout_ms }) => {
    const result = await runBash(
      command,
      cwd || DEFAULT_CWD,
      timeout_ms || DEFAULT_TIMEOUT_MS,
    )
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: result.exit_code !== 0,
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
// Keep the process alive on stdio; the transport closes it when the client
// disconnects. A boot-time log line on stderr lets init.sh / health checks
// confirm the server actually came up (stdout is reserved for the protocol).
process.stderr.write('[mcp-shell] ready on stdio\n')
