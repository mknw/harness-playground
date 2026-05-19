/**
 * Tool-config constants and types — client-safe (no "use server").
 *
 * These live outside `config.server.ts` because the SolidStart server-action
 * transform rewrites every export from a `"use server"` module into an RPC
 * stub on the client. Non-function exports (constants, types) come through
 * as `undefined`-like proxies, which broke `MINIMAL_TOOLS.includes(...)` in
 * `ToolsPanel.tsx`. Putting pure data here keeps the import path stable
 * (`~/lib/tool-config` still re-exports everything) while letting the
 * client see real arrays.
 */

/** Execution mode determines which planning flow to use. Reserved for a
 *  future planner-switch UX; currently the mode Switch is disabled. */
export type ExecutionMode = "static" | "code";

/** Catalog mode determines which tools are available. Reserved; the
 *  toggle is disabled since the kg-agent gateway eagerly loads all servers. */
export type CatalogMode = "minimal" | "global";

/** Snapshot returned to the Tools panel by `getCodeModeAllowedTools`. */
export interface CodeModeToolsState {
  /** User's current per-conversation selection. Falls back to `defaults`
   *  when the conversation has no entry yet (e.g. first turn). */
  allowed: string[];
  /** Live list of every tool the gateway exposes. */
  available: string[];
  /** Meta-tools the actor always needs (`mcp-find`, `mcp-add`, `code-mode`,
   *  `mcp-exec`). UI should render them pre-checked and locked-on. */
  defaults: string[];
}

/** Default "starter set" highlighted with a `Core` badge in the UI. */
export function getMinimalTools(): string[] {
  return [
    "read_neo4j_cypher",
    "write_neo4j_cypher",
    "get_neo4j_schema",
    "search",
    "fetch_content",
  ];
}

export const MINIMAL_TOOLS = getMinimalTools();

/** The four meta-tools the code-mode actor cannot function without. Mirrors
 *  CODE_MODE_TOOLS in `harness-client/examples/code-mode.server.ts` — keep
 *  in sync. */
export const CODE_MODE_DEFAULTS = ["mcp-find", "mcp-add", "code-mode", "mcp-exec"];
