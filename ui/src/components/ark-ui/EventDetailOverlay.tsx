/**
 * EventDetailOverlay Component
 *
 * Card overlay for expanded event details.
 * Shows full payload, result, timing, and allows deletion.
 * Includes text format toggle: raw / parsed / markdown
 */

import { Portal } from 'solid-js/web';
import { Show, For, createSignal, createMemo } from 'solid-js';
import { ToggleGroup } from '@ark-ui/solid/toggle-group';
import { marked } from 'marked';
import type { TelemetryEvent, BAMLCallTelemetry, ToolCallTelemetry } from '~/lib/baml-agent/telemetry';
import {
  isBAMLCallTelemetry,
  getBAMLFunctionLabel,
  getToolLabel,
  statusColors,
  namespaceHexColors
} from '~/lib/baml-agent/telemetry';

interface EventDetailOverlayProps {
  event: TelemetryEvent;
  onClose: () => void;
  onDelete: () => void;
}

type TextFormat = 'raw' | 'parsed' | 'marked';

export const EventDetailOverlay = (props: EventDetailOverlayProps) => {
  const [textFormat, setTextFormat] = createSignal<TextFormat>('parsed');

  const isBAML = () => isBAMLCallTelemetry(props.event);
  const bamlEvent = () => props.event as BAMLCallTelemetry;
  const toolEvent = () => props.event as ToolCallTelemetry;

  const getTitle = () => {
    if (isBAML()) {
      return getBAMLFunctionLabel(bamlEvent().functionName);
    }
    return getToolLabel(toolEvent().toolName);
  };

  const getHexColor = () => {
    if (isBAML()) {
      return '#6366f1'; // cyber-500
    }
    return namespaceHexColors[toolEvent().namespace];
  };

  const formatTimestamp = (ts: string) => {
    return new Date(ts).toLocaleTimeString();
  };

  /**
   * Format JSON data, attempting to stringify objects
   */
  const formatJson = (data: unknown): string => {
    if (typeof data === 'string') {
      return data;
    }
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  /**
   * Format text based on selected mode
   */
  const formatText = (text: string) => {
    switch (textFormat()) {
      case 'raw':
        // Show literal escape sequences
        return text;
      case 'parsed':
        // Replace \n with actual newlines, \t with tabs
        return text
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '');
      case 'marked': {
        // Parse as markdown
        const parsed = text
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '');
        return marked.parse(parsed) as string;
      }
    }
  };

  /**
   * Get the main output content to display
   */
  const outputContent = createMemo(() => {
    if (isBAML() && bamlEvent().output) {
      return formatJson(bamlEvent().output);
    }
    if (!isBAML() && toolEvent().rawResult) {
      return formatJson(toolEvent().rawResult);
    }
    return null;
  });

  return (
    <Portal>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          "background-color": "rgba(0, 0, 0, 0.6)",
          "z-index": "50",
          display: "flex",
          "align-items": "center",
          "justify-content": "center"
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        {/* Card */}
        <div
          bg="dark-bg-secondary"
          border="1 dark-border-primary"
          rounded="lg"
          w="max-[90vw] min-[500px]"
          max-h="85vh"
          overflow="hidden"
          flex="~ col"
          shadow="lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            p="4"
            border="b dark-border-primary"
            flex="~"
            items="center"
            justify="between"
            bg="dark-bg-tertiary"
          >
            <div flex="~" items="center" gap="3">
              {/* Status dot */}
              <div
                w="3"
                h="3"
                rounded="full"
                bg={statusColors[props.event.status]}
              />
              {/* Title */}
              <div>
                <div
                  style={{
                    color: getHexColor(),
                    'font-size': '14px',
                    'font-family': '"Fira Code", ui-monospace, monospace',
                    'font-weight': '500'
                  }}
                >
                  {getTitle()}
                </div>
                <div text="xs dark-text-tertiary">
                  {formatTimestamp(props.event.timestamp)}
                </div>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={() => props.onClose()}
              p="2"
              rounded="md"
              text="dark-text-secondary hover:dark-text-primary"
              bg="transparent hover:dark-bg-hover"
              cursor="pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div p="4" space="y-4" overflow="auto" flex="1">
            {/* Status & Timing Row */}
            <div flex="~" gap="4" flex-wrap="wrap">
              <div>
                <div text="xs dark-text-tertiary" m="b-1">Status</div>
                <div
                  text={`sm ${statusColors[props.event.status]}`}
                  font="medium"
                  class="capitalize"
                >
                  {props.event.status}
                </div>
              </div>

              <Show when={isBAML() && bamlEvent().latency_ms}>
                <div>
                  <div text="xs dark-text-tertiary" m="b-1">Latency</div>
                  <div text="sm dark-text-primary">{bamlEvent().latency_ms}ms</div>
                </div>
              </Show>

              <Show when={!isBAML() && toolEvent().duration_ms}>
                <div>
                  <div text="xs dark-text-tertiary" m="b-1">Duration</div>
                  <div text="sm dark-text-primary">{toolEvent().duration_ms}ms</div>
                </div>
              </Show>

              <Show when={isBAML() && bamlEvent().usage}>
                <div>
                  <div text="xs dark-text-tertiary" m="b-1">Tokens</div>
                  <div text="sm dark-text-primary">
                    {bamlEvent().usage!.input_tokens} in / {bamlEvent().usage!.output_tokens} out
                  </div>
                </div>
              </Show>

              <Show when={!isBAML() && toolEvent().result}>
                <div>
                  <div text="xs dark-text-tertiary" m="b-1">Results</div>
                  <div text="sm dark-text-primary">
                    {toolEvent().result!.nodeCount ?? 0} nodes, {toolEvent().result!.relationshipCount ?? 0} rels
                  </div>
                </div>
              </Show>
            </div>

            {/* Error */}
            <Show when={props.event.error}>
              <div>
                <div text="xs red-500" m="b-1" font="medium">Error</div>
                <pre
                  bg="red-900/20"
                  border="1 red-500/30"
                  p="3"
                  rounded="md"
                  text="xs red-400"
                  font="mono"
                  style={{ "white-space": "pre-wrap", "word-break": "break-word" }}
                  overflow="auto"
                  min-h="60px"
                  max-h="200px"
                >
                  {props.event.error}
                </pre>
              </div>
            </Show>

            {/* Input Parameters (for BAML calls) */}
            <Show when={isBAML() && bamlEvent().input}>
              <div>
                <div text="xs dark-text-tertiary" m="b-1" font="medium">Input Parameters</div>
                <div
                  bg="dark-bg-tertiary"
                  p="3"
                  rounded="md"
                  overflow="auto"
                  max-h="200px"
                >
                  <For each={Object.entries(bamlEvent().input || {})}>
                    {([key, value]) => (
                      <div m="b-2" class="last:mb-0">
                        <div
                          text="xs neon-purple"
                          font="mono medium"
                          m="b-1"
                        >
                          {key}
                        </div>
                        <pre
                          text="xs dark-text-secondary"
                          font="mono"
                          style={{ "white-space": "pre-wrap", "word-break": "break-word" }}
                          p="2"
                          bg="dark-bg-primary"
                          rounded="sm"
                        >
                          {typeof value === 'string' ? value : formatJson(value)}
                        </pre>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Payload (for tools) */}
            <Show when={!isBAML() && toolEvent().payload}>
              <div>
                <div text="xs dark-text-tertiary" m="b-1" font="medium">Tool Payload</div>
                <pre
                  bg="dark-bg-tertiary"
                  p="3"
                  rounded="md"
                  text="xs neon-cyan"
                  font="mono"
                  style={{ "white-space": "pre-wrap", "word-break": "break-word" }}
                  overflow="auto"
                  min-h="60px"
                  max-h="200px"
                >
                  {formatJson(toolEvent().payload)}
                </pre>
              </div>
            </Show>

            {/* Output/Result with Format Toggle */}
            <Show when={outputContent()}>
              <div>
                {/* Header with toggle */}
                <div flex="~" items="center" justify="between" m="b-2">
                  <div text="xs dark-text-tertiary" font="medium">
                    {isBAML() ? 'LLM Response' : 'Raw Result'}
                  </div>

                  {/* Text Format Toggle */}
                  <ToggleGroup.Root
                    value={[textFormat()]}
                    onValueChange={(details) => {
                      if (details.value.length > 0) {
                        setTextFormat(details.value[0] as TextFormat);
                      }
                    }}
                    style={{ display: 'flex', gap: '4px' }}
                  >
                    <ToggleGroup.Item
                      value="raw"
                      style={{
                        padding: '4px 8px',
                        'font-size': '12px',
                        'border-radius': '6px',
                        cursor: 'pointer',
                        background: textFormat() === 'raw' ? '#22222f' : 'transparent',
                        border: textFormat() === 'raw' ? '1px solid #6366f1' : '1px solid #3a3a4a',
                        color: textFormat() === 'raw' ? '#00ffff' : '#a1a1aa',
                        transition: 'all 0.2s'
                      }}
                    >
                      Raw
                    </ToggleGroup.Item>
                    <ToggleGroup.Item
                      value="parsed"
                      style={{
                        padding: '4px 8px',
                        'font-size': '12px',
                        'border-radius': '6px',
                        cursor: 'pointer',
                        background: textFormat() === 'parsed' ? '#22222f' : 'transparent',
                        border: textFormat() === 'parsed' ? '1px solid #6366f1' : '1px solid #3a3a4a',
                        color: textFormat() === 'parsed' ? '#00ffff' : '#a1a1aa',
                        transition: 'all 0.2s'
                      }}
                    >
                      Parsed
                    </ToggleGroup.Item>
                    <ToggleGroup.Item
                      value="marked"
                      style={{
                        padding: '4px 8px',
                        'font-size': '12px',
                        'border-radius': '6px',
                        cursor: 'pointer',
                        background: textFormat() === 'marked' ? '#22222f' : 'transparent',
                        border: textFormat() === 'marked' ? '1px solid #6366f1' : '1px solid #3a3a4a',
                        color: textFormat() === 'marked' ? '#00ffff' : '#a1a1aa',
                        transition: 'all 0.2s'
                      }}
                    >
                      Markdown
                    </ToggleGroup.Item>
                  </ToggleGroup.Root>
                </div>

                {/* Content display */}
                <Show when={textFormat() === 'marked'}>
                  {/* Markdown rendered as HTML - innerHTML intentional for markdown */}
                  <div
                    bg="dark-bg-tertiary"
                    p="3"
                    rounded="md"
                    text="sm dark-text-secondary"
                    min-h="100px"
                    max-h="400px"
                    overflow="auto"
                    class="prose prose-invert prose-sm max-w-none"
                    // eslint-disable-next-line solid/no-innerhtml
                    innerHTML={formatText(outputContent()!)}
                  />
                </Show>
                <Show when={textFormat() !== 'marked'}>
                  {/* Raw or Parsed as preformatted text */}
                  <pre
                    bg="dark-bg-tertiary"
                    p="3"
                    rounded="md"
                    text="xs dark-text-secondary"
                    font="mono"
                    style={{ "white-space": "pre-wrap", "word-break": "break-word" }}
                    min-h="100px"
                    max-h="400px"
                    overflow="auto"
                  >
                    {formatText(outputContent()!)}
                  </pre>
                </Show>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div
            p="4"
            border="t dark-border-primary"
            flex="~"
            justify="end"
            gap="2"
            bg="dark-bg-tertiary"
          >
            <button
              onClick={() => props.onDelete()}
              p="x-4 y-2"
              text="sm red-400"
              bg="red-600/10 hover:red-600/20"
              border="1 red-500/30"
              rounded="md"
              cursor="pointer"
              transition="all"
              font="medium"
              flex="~"
              items="center"
              gap="2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Delete Event
            </button>
            <button
              onClick={() => props.onClose()}
              p="x-4 y-2"
              text="sm dark-text-primary"
              bg="dark-bg-hover hover:dark-border-accent"
              border="1 dark-border-secondary"
              rounded="md"
              cursor="pointer"
              transition="all"
              font="medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};
