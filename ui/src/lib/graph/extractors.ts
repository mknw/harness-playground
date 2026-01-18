/**
 * Generic Event Extractors
 *
 * Tool-agnostic extraction of data from tool events.
 * Each extractor handles a specific data format.
 *
 * This design allows adding new extractors for different data sources
 * without changing the core harness-patterns library.
 */

import type { ElementDefinition } from 'cytoscape';

// ============================================================================
// Tool Event Type (local definition)
// ============================================================================

/**
 * Generic tool event structure for extractors.
 * Matches the shape of events from tool execution.
 */
export interface ToolEvent {
  status_code: number;
  status_description: string;
  operation: string;
  data: unknown;
  n_turn: number;
  stats?: {
    duration_ms?: number;
    token_count?: number;
  };
}
import {
  parseNeo4jResults,
  transformNeo4jToCytoscape
} from './transform';

// ============================================================================
// Generic Extractor Type
// ============================================================================

/**
 * Generic event extractor type.
 * Each extractor processes ToolEvents and returns extracted data.
 *
 * @template T - The type of data extracted
 */
export type EventExtractor<T> = (events: ToolEvent[]) => T[];

/**
 * Extractor with format detection.
 * Returns null if data doesn't match expected format.
 */
export type DataExtractor<TInput, TOutput> = (data: TInput) => TOutput[] | null;

// ============================================================================
// Graph Extractors
// ============================================================================

/**
 * Extract graph elements from tool events.
 * Tries multiple format extractors in sequence.
 *
 * This is the main extractor for graph visualization.
 * It handles Neo4j results and can be extended for other graph formats.
 */
export const extractGraphFromToolEvents: EventExtractor<ElementDefinition> = (events) => {
  const elements: ElementDefinition[] = [];

  for (const event of events) {
    if (event.status_code !== 200 || !event.data) {
      continue;
    }

    // Try each graph extractor in order
    const graphData = extractGraphFromData(event.data);
    elements.push(...graphData);
  }

  return elements;
};

/**
 * Extract graph data from any data source.
 * Tries multiple extractors in sequence.
 */
function extractGraphFromData(data: unknown): ElementDefinition[] {
  // Try Neo4j extractor first (most common)
  const neo4jGraph = extractNeo4jGraph(data);
  if (neo4jGraph.length > 0) {
    return neo4jGraph;
  }

  // Add more extractors here as needed:
  // - GraphQL responses
  // - RDF/SPARQL results
  // - Custom graph formats

  return [];
}

/**
 * Extract graph from Neo4j query results.
 * Handles various Neo4j result formats.
 */
function extractNeo4jGraph(data: unknown): ElementDefinition[] {
  try {
    const parsed = parseNeo4jResults(data);

    if (!parsed.nodes?.length && !parsed.relationships?.length) {
      return [];
    }

    return transformNeo4jToCytoscape(
      parsed.nodes || [],
      parsed.relationships || []
    );
  } catch {
    // Not Neo4j data or parsing failed
    return [];
  }
}

// ============================================================================
// Metadata Extractors
// ============================================================================

/**
 * Extracted metadata from tool events
 */
export interface ToolEventMetadata {
  toolName: string;
  status: 'success' | 'error';
  duration_ms?: number;
  turn: number;
}

/**
 * Extract metadata from tool events.
 * Useful for displaying execution summary.
 */
export const extractMetadataFromToolEvents: EventExtractor<ToolEventMetadata> = (events) => {
  return events.map((event) => ({
    toolName: extractToolName(event.operation),
    status: event.status_code === 200 ? 'success' : 'error',
    duration_ms: event.stats?.duration_ms,
    turn: event.n_turn
  }));
};

/**
 * Extract tool name from operation string
 */
function extractToolName(operation: string): string {
  try {
    const parsed = JSON.parse(operation);
    // Try common patterns
    if (parsed.tool) return parsed.tool;
    if (parsed.toolName) return parsed.toolName;
    if (parsed.name) return parsed.name;
    return 'unknown';
  } catch {
    // Operation might be the tool name itself
    return operation.length < 50 ? operation : 'unknown';
  }
}

// ============================================================================
// Raw Data Extractors
// ============================================================================

/**
 * Extract raw results from successful tool events.
 * Returns the data payload from each successful execution.
 */
export const extractRawResults: EventExtractor<unknown> = (events) => {
  return events
    .filter((event) => event.status_code === 200 && event.data !== null)
    .map((event) => event.data);
};

/**
 * Extract error messages from failed tool events.
 */
export const extractErrors: EventExtractor<string> = (events) => {
  return events
    .filter((event) => event.status_code !== 200)
    .map((event) => event.status_description);
};

// ============================================================================
// Composable Extractors
// ============================================================================

/**
 * Combine multiple extractors into one.
 * Results are deduplicated by reference.
 */
export function combineExtractors<T>(
  ...extractors: EventExtractor<T>[]
): EventExtractor<T> {
  return (events) => {
    const seen = new Set<T>();
    const results: T[] = [];

    for (const extractor of extractors) {
      for (const item of extractor(events)) {
        if (!seen.has(item)) {
          seen.add(item);
          results.push(item);
        }
      }
    }

    return results;
  };
}

/**
 * Filter extractor results.
 */
export function filterExtractor<T>(
  extractor: EventExtractor<T>,
  predicate: (item: T) => boolean
): EventExtractor<T> {
  return (events) => extractor(events).filter(predicate);
}

/**
 * Map extractor results to a different type.
 */
export function mapExtractor<T, U>(
  extractor: EventExtractor<T>,
  mapper: (item: T) => U
): EventExtractor<U> {
  return (events) => extractor(events).map(mapper);
}

// ============================================================================
// Future Extractors (placeholders for extension)
// ============================================================================

// Uncomment and implement as needed:

// /** Extract from GraphQL responses */
// export function extractFromGraphQL(data: unknown): ElementDefinition[] {
//   // Implementation for GraphQL graph responses
//   return [];
// }

// /** Extract from RDF/SPARQL results */
// export function extractFromRDF(data: unknown): ElementDefinition[] {
//   // Implementation for RDF triples
//   return [];
// }

// /** Extract from JSON-LD */
// export function extractFromJsonLD(data: unknown): ElementDefinition[] {
//   // Implementation for JSON-LD graph data
//   return [];
// }
