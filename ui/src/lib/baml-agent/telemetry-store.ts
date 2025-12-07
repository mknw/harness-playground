/**
 * Telemetry Store - Client-side Reactive State for Observability
 *
 * Uses SolidJS createStore for reactive updates to the Observability Panel.
 * Supports:
 * - Adding BAML and tool telemetry events
 * - Expanding events into overlay cards
 * - Deleting individual events
 * - Computing aggregate metrics
 * - Serialization for future localStorage persistence
 */

import { createStore, produce } from 'solid-js/store';
import { createMemo } from 'solid-js';
import type {
  BAMLCallTelemetry,
  ToolCallTelemetry,
  TelemetryMetrics,
  BAMLFunctionName,
  ToolNamespace,
  TelemetryEvent
} from './telemetry';

// ============================================================================
// State Interface
// ============================================================================

interface TelemetryState {
  /** BAML function call telemetry */
  bamlCalls: BAMLCallTelemetry[];
  /** Tool execution telemetry */
  toolCalls: ToolCallTelemetry[];
  /** ID of currently expanded event (for overlay) */
  expandedEventId: string | null;
  /** Collapsible section states */
  isExpanded: {
    interface: boolean;
    tools: boolean;
  };
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: TelemetryState = {
  bamlCalls: [],
  toolCalls: [],
  expandedEventId: null,
  isExpanded: {
    interface: true,
    tools: true
  }
};

// ============================================================================
// Store Factory
// ============================================================================

export function createTelemetryStore() {
  const [state, setState] = createStore<TelemetryState>({ ...initialState });

  // --------------------------------------------------------------------------
  // BAML Call Actions
  // --------------------------------------------------------------------------

  /** Add a BAML function call telemetry event */
  const addBAMLCall = (call: BAMLCallTelemetry) => {
    setState(produce((s) => {
      s.bamlCalls.push(call);
    }));
  };

  /** Update an existing BAML call (e.g., when it completes) */
  const updateBAMLCall = (id: string, updates: Partial<BAMLCallTelemetry>) => {
    setState(produce((s) => {
      const index = s.bamlCalls.findIndex(c => c.id === id);
      if (index !== -1) {
        Object.assign(s.bamlCalls[index], updates);
      }
    }));
  };

  // --------------------------------------------------------------------------
  // Tool Call Actions
  // --------------------------------------------------------------------------

  /** Add a tool execution telemetry event */
  const addToolCall = (call: ToolCallTelemetry) => {
    setState(produce((s) => {
      s.toolCalls.push(call);
    }));
  };

  /** Update an existing tool call (e.g., when it completes) */
  const updateToolCall = (id: string, updates: Partial<ToolCallTelemetry>) => {
    setState(produce((s) => {
      const index = s.toolCalls.findIndex(c => c.id === id);
      if (index !== -1) {
        Object.assign(s.toolCalls[index], updates);
      }
    }));
  };

  // --------------------------------------------------------------------------
  // Event Management
  // --------------------------------------------------------------------------

  /** Delete an event by ID (from either BAML or tool calls) */
  const deleteEvent = (id: string) => {
    setState(produce((s) => {
      const bamlIndex = s.bamlCalls.findIndex(c => c.id === id);
      if (bamlIndex !== -1) {
        s.bamlCalls.splice(bamlIndex, 1);
      } else {
        const toolIndex = s.toolCalls.findIndex(c => c.id === id);
        if (toolIndex !== -1) {
          s.toolCalls.splice(toolIndex, 1);
        }
      }
      // Close overlay if this event was expanded
      if (s.expandedEventId === id) {
        s.expandedEventId = null;
      }
    }));
  };

  /** Get an event by ID */
  const getEvent = (id: string): TelemetryEvent | undefined => {
    return state.bamlCalls.find(c => c.id === id) ||
           state.toolCalls.find(c => c.id === id);
  };

  // --------------------------------------------------------------------------
  // Overlay Actions
  // --------------------------------------------------------------------------

  /** Expand an event into the overlay card */
  const expandEvent = (id: string) => {
    setState('expandedEventId', id);
  };

  /** Close the overlay */
  const collapseEvent = () => {
    setState('expandedEventId', null);
  };

  // --------------------------------------------------------------------------
  // Section Actions
  // --------------------------------------------------------------------------

  /** Toggle a collapsible section */
  const toggleSection = (section: 'interface' | 'tools') => {
    setState('isExpanded', section, (v) => !v);
  };

  // --------------------------------------------------------------------------
  // Clear Actions
  // --------------------------------------------------------------------------

  /** Clear all telemetry data */
  const clearTelemetry = () => {
    setState({
      bamlCalls: [],
      toolCalls: [],
      expandedEventId: null
    });
  };

  // --------------------------------------------------------------------------
  // Computed Metrics
  // --------------------------------------------------------------------------

  /** Compute aggregate metrics reactively */
  const metrics = createMemo((): TelemetryMetrics => {
    const bamlCalls = state.bamlCalls;
    const toolCalls = state.toolCalls;
    const allCalls = [...bamlCalls, ...toolCalls];

    const successCalls = allCalls.filter(c => c.status === 'success');

    // Calculate average latency
    const latencies = [
      ...bamlCalls.filter(c => c.latency_ms !== undefined).map(c => c.latency_ms!),
      ...toolCalls.filter(c => c.duration_ms !== undefined).map(c => c.duration_ms!)
    ];
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    // Calculate total tokens
    const totalTokens = bamlCalls
      .filter(c => c.usage)
      .reduce((acc, c) => ({
        input: acc.input + (c.usage?.input_tokens || 0),
        output: acc.output + (c.usage?.output_tokens || 0)
      }), { input: 0, output: 0 });

    // Count by function
    const callsByFunction = bamlCalls.reduce((acc, c) => {
      acc[c.functionName] = (acc[c.functionName] || 0) + 1;
      return acc;
    }, {} as Partial<Record<BAMLFunctionName, number>>);

    // Count by namespace
    const callsByNamespace = toolCalls.reduce((acc, c) => {
      acc[c.namespace] = (acc[c.namespace] || 0) + 1;
      return acc;
    }, {} as Partial<Record<ToolNamespace, number>>);

    return {
      totalCalls: allCalls.length,
      successRate: allCalls.length > 0 ? successCalls.length / allCalls.length : 1,
      avgLatency_ms: Math.round(avgLatency),
      totalTokens,
      callsByFunction,
      callsByNamespace
    };
  });

  // --------------------------------------------------------------------------
  // Serialization (for future localStorage)
  // --------------------------------------------------------------------------

  /** Serialize state for persistence */
  const serialize = (): string => {
    return JSON.stringify({
      bamlCalls: state.bamlCalls,
      toolCalls: state.toolCalls
    });
  };

  /** Restore state from serialized data */
  const restore = (data: string) => {
    try {
      const parsed = JSON.parse(data);
      setState(produce((s) => {
        s.bamlCalls = parsed.bamlCalls || [];
        s.toolCalls = parsed.toolCalls || [];
      }));
    } catch (e) {
      console.error('Failed to restore telemetry state:', e);
    }
  };

  // --------------------------------------------------------------------------
  // Return Store API
  // --------------------------------------------------------------------------

  return {
    state,
    metrics,
    // BAML actions
    addBAMLCall,
    updateBAMLCall,
    // Tool actions
    addToolCall,
    updateToolCall,
    // Event management
    deleteEvent,
    getEvent,
    // Overlay
    expandEvent,
    collapseEvent,
    // Sections
    toggleSection,
    // Clear
    clearTelemetry,
    // Persistence
    serialize,
    restore
  };
}

// ============================================================================
// Type Export
// ============================================================================

export type TelemetryStore = ReturnType<typeof createTelemetryStore>;
