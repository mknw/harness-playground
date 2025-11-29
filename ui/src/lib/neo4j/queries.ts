/**
 * Neo4j Query Server Functions (Non-Agentic Layer)
 *
 * Server-side functions for direct Neo4j operations:
 * - Schema fetching for agent initialization
 * - Manual Cypher queries from GraphVisualization
 * - Connection management
 *
 * These operations bypass BAML/UTCP for performance and simplicity.
 */

"use server";

import { getNeo4jDriver, resetDriver, verifyConnection, type Neo4jCredentials } from './client';
import { transformNeo4jToCytoscape, parseNeo4jResults } from '../graph/transform';

// ============================================================================
// Types
// ============================================================================

export interface SchemaResult {
  success: boolean;
  schema?: string;
  error?: string;
}

export interface CypherResult {
  success: boolean;
  graphUpdate?: ReturnType<typeof transformNeo4jToCytoscape>;
  raw?: unknown[];
  error?: string;
}

export interface ConnectionResult {
  success: boolean;
  error?: string;
}

// ============================================================================
// Schema Operations
// ============================================================================

/**
 * Fetch the Neo4j database schema
 * Used by agent for context about available node types and relationships
 *
 * @param credentials - Optional credentials from client-side EnvVarManager
 */
export async function getSchema(credentials?: Neo4jCredentials): Promise<SchemaResult> {
  "use server";

  const session = getNeo4jDriver(credentials).session();
  try {
    const result = await session.run('CALL db.schema.visualization()');
    return {
      success: true,
      schema: JSON.stringify(result.records, null, 2)
    };
  } catch (error) {
    console.error('Failed to fetch schema:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await session.close();
  }
}

/**
 * Get a simplified schema representation
 * Useful for smaller context windows
 */
export async function getSimplifiedSchema(credentials?: Neo4jCredentials): Promise<SchemaResult> {
  "use server";

  const session = getNeo4jDriver(credentials).session();
  try {
    // Get node labels
    const labelsResult = await session.run('CALL db.labels()');
    const labels = labelsResult.records.map(r => r.get(0));

    // Get relationship types
    const relTypesResult = await session.run('CALL db.relationshipTypes()');
    const relTypes = relTypesResult.records.map(r => r.get(0));

    // Get property keys
    const propsResult = await session.run('CALL db.propertyKeys()');
    const propKeys = propsResult.records.map(r => r.get(0));

    const schema = {
      nodeLabels: labels,
      relationshipTypes: relTypes,
      propertyKeys: propKeys
    };

    return {
      success: true,
      schema: JSON.stringify(schema, null, 2)
    };
  } catch (error) {
    console.error('Failed to fetch simplified schema:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await session.close();
  }
}

// ============================================================================
// Node Property Operations
// ============================================================================

export interface NodePropertiesResult {
  success: boolean;
  properties?: Record<string, unknown>;
  labels?: string[];
  error?: string;
}

/**
 * Fetch properties for a specific node by element ID
 * Used when clicking on a graph node that doesn't have properties loaded
 *
 * @param elementId - Neo4j 5.x element ID (e.g., "4:xxx:123")
 */
export async function getNodeProperties(
  elementId: string
): Promise<NodePropertiesResult> {
  "use server";

  const session = getNeo4jDriver().session();
  try {
    const result = await session.run(
      'MATCH (n) WHERE elementId(n) = $elementId RETURN properties(n) as props, labels(n) as labels',
      { elementId }
    );

    if (result.records.length === 0) {
      return { success: false, error: 'Node not found' };
    }

    const record = result.records[0];
    return {
      success: true,
      properties: record.get('props') as Record<string, unknown>,
      labels: record.get('labels') as string[]
    };
  } catch (error) {
    console.error('Failed to fetch node properties:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await session.close();
  }
}

// ============================================================================
// Manual Cypher Operations
// ============================================================================

/**
 * Execute a read-only Cypher query (for GraphVisualization manual input)
 *
 * @param cypher - The Cypher query to execute
 * @param credentials - Optional credentials from client-side EnvVarManager
 */
export async function runManualCypher(
  cypher: string,
  credentials?: Neo4jCredentials
): Promise<CypherResult> {
  "use server";

  // Basic safety check - reject write operations
  const normalizedQuery = cypher.trim().toUpperCase();
  const writeKeywords = ['CREATE', 'MERGE', 'SET', 'DELETE', 'REMOVE', 'DETACH'];

  for (const keyword of writeKeywords) {
    if (normalizedQuery.includes(keyword)) {
      return {
        success: false,
        error: `Manual queries cannot use write operations (${keyword}). Use the chat interface for modifications.`
      };
    }
  }

  const session = getNeo4jDriver(credentials).session();
  try {
    const result = await session.run(cypher);

    // Parse and transform results for Cytoscape
    const parsed = parseNeo4jResults({ records: result.records });
    const graphData = transformNeo4jToCytoscape(
      parsed.nodes || [],
      parsed.relationships || []
    );

    return {
      success: true,
      graphUpdate: graphData,
      raw: result.records.map(r => r.toObject())
    };
  } catch (error) {
    console.error('Manual Cypher query failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await session.close();
  }
}

/**
 * Execute a write Cypher query (internal use, requires approval flow)
 * This is called by the agentic layer after user approval
 *
 * @param cypher - The Cypher query to execute
 * @param credentials - Optional credentials from client-side EnvVarManager
 */
export async function executeWriteCypher(
  cypher: string,
  credentials?: Neo4jCredentials
): Promise<CypherResult> {
  "use server";

  const session = getNeo4jDriver(credentials).session();
  try {
    const result = await session.run(cypher);

    // Parse and transform results for Cytoscape
    const parsed = parseNeo4jResults({ records: result.records });
    const graphData = transformNeo4jToCytoscape(
      parsed.nodes || [],
      parsed.relationships || []
    );

    console.log(`✅ Write query executed: ${cypher.substring(0, 50)}...`);

    return {
      success: true,
      graphUpdate: graphData,
      raw: result.records.map(r => r.toObject())
    };
  } catch (error) {
    console.error('Write Cypher query failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await session.close();
  }
}

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Reset the Neo4j connection
 * Call this when credentials change in EnvVarManager
 */
export async function resetNeo4jConnection(): Promise<ConnectionResult> {
  "use server";

  try {
    await resetDriver();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Test the Neo4j connection with optional credentials
 */
export async function testNeo4jConnection(
  credentials?: Neo4jCredentials
): Promise<ConnectionResult> {
  "use server";

  try {
    const connected = await verifyConnection(credentials);
    return {
      success: connected,
      error: connected ? undefined : 'Connection verification failed'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
