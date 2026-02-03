/**
 * Graph Element Extractor
 *
 * Extracts graph elements (nodes and edges) from harness context events.
 * Maps pattern IDs to graph sources (neo4j, memory) for UI tab filtering.
 */

import type { ElementDefinition } from 'cytoscape'
import type { GraphElement } from '~/components/ark-ui/SupportPanel'

// ============================================================================
// Pattern to Source Mapping
// ============================================================================

/** Map pattern IDs to graph sources */
const PATTERN_SOURCE_MAP: Record<string, GraphElement['source']> = {
  // Neo4j patterns
  'neo4j-query': 'neo4j',
  'neo4j': 'neo4j',
  'kg-builder': 'neo4j',
  'ontology': 'neo4j',

  // Memory patterns
  'memory': 'memory',
  'memory-loop': 'memory',
  'session-memory': 'memory',
  'conversational-memory': 'memory',

  // Default to unknown for other patterns
}

/** Determine graph source from pattern ID */
function getSourceFromPattern(patternId: string): GraphElement['source'] {
  // Check exact match first
  if (PATTERN_SOURCE_MAP[patternId]) {
    return PATTERN_SOURCE_MAP[patternId]
  }

  // Check prefix matches
  if (patternId.startsWith('neo4j') || patternId.includes('neo4j')) {
    return 'neo4j'
  }
  if (patternId.startsWith('memory') || patternId.includes('memory')) {
    return 'memory'
  }

  return 'unknown'
}

// ============================================================================
// Tool Result Parsing
// ============================================================================

/** Check if a tool result contains Neo4j graph data */
function isNeo4jGraphResult(toolName: string, result: unknown): boolean {
  const neo4jTools = [
    'read_neo4j_cypher',
    'write_neo4j_cypher',
    'get_neo4j_schema'
  ]
  return neo4jTools.some(t => toolName.includes(t))
}

/** Check if a tool result contains Memory graph data */
function isMemoryGraphResult(toolName: string, result: unknown): boolean {
  const memoryTools = [
    'read_graph',
    'search_nodes',
    'open_nodes',
    'create_entities',
    'create_relations',
    'add_observations'
  ]
  return memoryTools.some(t => toolName.includes(t))
}

/** Parse Neo4j Cypher result into graph elements */
function parseNeo4jResult(result: unknown, source: GraphElement['source']): GraphElement[] {
  const elements: GraphElement[] = []

  if (!result || typeof result !== 'object') return elements

  // Handle array of records (typical Cypher result)
  const records = Array.isArray(result) ? result : [result]

  for (const record of records) {
    if (!record || typeof record !== 'object') continue

    // Extract nodes and relationships from record values
    for (const value of Object.values(record as Record<string, unknown>)) {
      const extracted = extractGraphEntities(value, source)
      elements.push(...extracted)
    }
  }

  return deduplicateElements(elements)
}

/** Parse Memory MCP result into graph elements */
function parseMemoryResult(result: unknown, source: GraphElement['source']): GraphElement[] {
  const elements: GraphElement[] = []

  if (!result || typeof result !== 'object') return elements

  // Memory graph structure: { entities: [...], relations: [...] }
  const data = result as Record<string, unknown>

  // Parse entities as nodes
  if (Array.isArray(data.entities)) {
    for (const entity of data.entities) {
      if (entity && typeof entity === 'object') {
        const e = entity as Record<string, unknown>
        const id = String(e.name ?? e.id ?? `entity-${elements.length}`)
        elements.push({
          data: {
            id,
            label: String(e.name ?? id),
            type: String(e.entityType ?? 'Entity'),
            observations: e.observations,
            ...e
          },
          source
        })
      }
    }
  }

  // Parse relations as edges
  if (Array.isArray(data.relations)) {
    for (const relation of data.relations) {
      if (relation && typeof relation === 'object') {
        const r = relation as Record<string, unknown>
        const id = `${r.from}-${r.relationType}-${r.to}`
        elements.push({
          data: {
            id,
            source: String(r.from),
            target: String(r.to),
            label: String(r.relationType ?? 'RELATES_TO'),
            ...r
          },
          source
        })
      }
    }
  }

  return deduplicateElements(elements)
}

/** Extract graph entities from a value (recursive) */
function extractGraphEntities(value: unknown, source: GraphElement['source']): GraphElement[] {
  const elements: GraphElement[] = []

  if (!value || typeof value !== 'object') return elements

  // Check if it's a Neo4j Node
  if (isNeo4jNode(value)) {
    const node = value as Neo4jNode
    elements.push({
      data: {
        id: String(node.identity ?? node.elementId ?? `node-${Date.now()}`),
        label: node.properties?.name ?? node.labels?.[0] ?? 'Node',
        type: node.labels?.[0] ?? 'Node',
        ...node.properties
      },
      source
    })
  }

  // Check if it's a Neo4j Relationship
  if (isNeo4jRelationship(value)) {
    const rel = value as Neo4jRelationship
    elements.push({
      data: {
        id: String(rel.identity ?? rel.elementId ?? `rel-${Date.now()}`),
        source: String(rel.start ?? rel.startNodeElementId),
        target: String(rel.end ?? rel.endNodeElementId),
        label: rel.type ?? 'RELATES_TO',
        ...rel.properties
      },
      source
    })
  }

  // Check if it's a Neo4j Path
  if (isNeo4jPath(value)) {
    const path = value as Neo4jPath
    if (path.segments) {
      for (const segment of path.segments) {
        elements.push(...extractGraphEntities(segment.start, source))
        elements.push(...extractGraphEntities(segment.relationship, source))
        elements.push(...extractGraphEntities(segment.end, source))
      }
    }
  }

  // Recurse into arrays
  if (Array.isArray(value)) {
    for (const item of value) {
      elements.push(...extractGraphEntities(item, source))
    }
  }

  return elements
}

// ============================================================================
// Neo4j Type Guards
// ============================================================================

interface Neo4jNode {
  identity?: number | string
  elementId?: string
  labels?: string[]
  properties?: Record<string, unknown>
}

interface Neo4jRelationship {
  identity?: number | string
  elementId?: string
  type?: string
  start?: number | string
  end?: number | string
  startNodeElementId?: string
  endNodeElementId?: string
  properties?: Record<string, unknown>
}

interface Neo4jPath {
  segments?: Array<{
    start: Neo4jNode
    relationship: Neo4jRelationship
    end: Neo4jNode
  }>
}

function isNeo4jNode(value: unknown): value is Neo4jNode {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    ('identity' in v || 'elementId' in v) &&
    (Array.isArray(v.labels) || v.properties !== undefined)
  )
}

function isNeo4jRelationship(value: unknown): value is Neo4jRelationship {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    ('identity' in v || 'elementId' in v) &&
    ('type' in v || 'start' in v || 'end' in v)
  )
}

function isNeo4jPath(value: unknown): value is Neo4jPath {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return 'segments' in v && Array.isArray(v.segments)
}

// ============================================================================
// Deduplication
// ============================================================================

function deduplicateElements(elements: GraphElement[]): GraphElement[] {
  const seen = new Set<string>()
  return elements.filter(el => {
    const id = el.data?.id
    if (!id || seen.has(String(id))) return false
    seen.add(String(id))
    return true
  })
}

// ============================================================================
// Main Extractor
// ============================================================================

/** Event structure from harness context */
interface ToolResultEvent {
  type: 'tool_result'
  ts: number
  patternId: string
  data: {
    tool: string
    result: unknown
    success: boolean
    error?: string
  }
}

/** Extract graph elements from harness context events */
export function extractGraphElements(events: unknown[]): GraphElement[] {
  const elements: GraphElement[] = []

  for (const event of events) {
    if (!event || typeof event !== 'object') continue

    const e = event as Record<string, unknown>

    // Only process tool_result events
    if (e.type !== 'tool_result') continue

    const toolEvent = event as ToolResultEvent
    const { patternId, data } = toolEvent

    if (!data?.success || !data?.result) continue

    const toolName = data.tool ?? ''
    const result = data.result

    // Determine source based on pattern ID and tool name
    let source = getSourceFromPattern(patternId)

    // Override source based on tool type if unknown
    if (source === 'unknown') {
      if (isNeo4jGraphResult(toolName, result)) {
        source = 'neo4j'
      } else if (isMemoryGraphResult(toolName, result)) {
        source = 'memory'
      }
    }

    // Parse based on tool type
    if (isNeo4jGraphResult(toolName, result)) {
      elements.push(...parseNeo4jResult(result, source))
    } else if (isMemoryGraphResult(toolName, result)) {
      elements.push(...parseMemoryResult(result, source))
    }
  }

  return deduplicateElements(elements)
}

/** Extract graph elements from a harness result */
export function extractGraphFromResult(result: {
  context?: { events?: unknown[] }
}): GraphElement[] {
  if (!result?.context?.events) return []
  return extractGraphElements(result.context.events)
}
