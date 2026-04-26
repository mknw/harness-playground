/**
 * Built-in content transforms for EventView.
 *
 * These are read-time lenses — they never mutate stored events.
 * Each transform takes a ContextEvent and returns a new one.
 */

import type { ContextEvent, ContentTransform, AssistantMessageEventData, ToolResultEventData } from './types'

/** Strip <think>...</think> chain-of-thought blocks from assistant messages.
 *  Useful for router history where reasoning tokens waste context and confuse smaller models. */
export const stripThinkBlocks: ContentTransform = (event: ContextEvent): ContextEvent => {
  if (event.type !== 'assistant_message') return event
  const data = event.data as AssistantMessageEventData
  const cleaned = data.content.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
  if (cleaned === data.content) return event // No change, return original
  return {
    ...event,
    data: { ...data, content: cleaned }
  }
}

/** Truncate long tool results to a maximum character count.
 *  Returns a factory — call with max chars: `truncateToolResults(2000)`. */
export const truncateToolResults = (maxChars: number): ContentTransform => (event: ContextEvent): ContextEvent => {
  if (event.type !== 'tool_result') return event
  const data = event.data as ToolResultEventData
  const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
  if (resultStr.length <= maxChars) return event
  return {
    ...event,
    data: { ...data, result: resultStr.slice(0, maxChars) + '...[truncated]' }
  }
}
