/**
 * Request-scoped user context for harness execution.
 *
 * Mirrors `settings-context.server.ts`: a tiny AsyncLocalStorage that lets
 * pattern closures read the authenticated userId at runtime without
 * threading it through every signature.
 *
 * `runTurn` (actions.server.ts) wraps its body in `runWithUserId(userId, …)`.
 * Pattern factories that need to load per-conversation context inside their
 * closures (e.g. code-mode reading `data.codeModeAllowedTools`) call
 * `getRequestUserId()` at the point of execution.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { assertServerOnImport } from "../harness-patterns/assert.server";

assertServerOnImport();

const userStore = new AsyncLocalStorage<string>();

export function runWithUserId<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return userStore.run(userId, fn);
}

/** Returns the request's userId, or null when called outside a runWithUserId
 *  scope (e.g. background summarization). Callers must handle null. */
export function getRequestUserId(): string | null {
  return userStore.getStore() ?? null;
}
