/**
 * Tests for Telemetry Module
 *
 * Tests type guards, display helpers, and color mappings
 * for the observability panel telemetry system.
 */

import { describe, it, expect } from 'vitest';
import {
  isBAMLCallTelemetry,
  isToolCallTelemetry,
  isInterfaceLane,
  getEventLabel,
  getEventDuration,
  getEventHexColor,
  isInterfaceFunction,
  getBAMLFunctionLabel,
  getToolLabel,
  getNamespaceFromTool,
  namespaceColors,
  namespaceHexColors,
  statusColors,
  type BAMLCallTelemetry,
  type ToolCallTelemetry,
  type TimelineEvent,
  type BAMLFunctionName
} from '../telemetry';

describe('telemetry', () => {
  // Sample test data
  const mockBAMLCall: BAMLCallTelemetry = {
    id: 'baml-1',
    functionName: 'RouteUserMessage',
    timestamp: '2025-01-01T00:00:00Z',
    status: 'success',
    usage: { input_tokens: 100, output_tokens: 50 },
    latency_ms: 250
  };

  const mockToolCall: ToolCallTelemetry = {
    id: 'tool-1',
    namespace: 'neo4j',
    toolName: 'read_neo4j_cypher',
    timestamp: '2025-01-01T00:00:01Z',
    status: 'success',
    duration_ms: 120
  };

  describe('Type Guards', () => {
    describe('isBAMLCallTelemetry', () => {
      it('should return true for BAML call events', () => {
        expect(isBAMLCallTelemetry(mockBAMLCall)).toBe(true);
      });

      it('should return false for tool call events', () => {
        expect(isBAMLCallTelemetry(mockToolCall)).toBe(false);
      });
    });

    describe('isToolCallTelemetry', () => {
      it('should return true for tool call events', () => {
        expect(isToolCallTelemetry(mockToolCall)).toBe(true);
      });

      it('should return false for BAML call events', () => {
        expect(isToolCallTelemetry(mockBAMLCall)).toBe(false);
      });
    });

    describe('isInterfaceLane', () => {
      it('should return true for interface lane events', () => {
        const event: TimelineEvent = { ...mockBAMLCall, lane: 'interface' };
        expect(isInterfaceLane(event)).toBe(true);
      });

      it('should return false for tools lane events', () => {
        const event: TimelineEvent = { ...mockToolCall, lane: 'tools' };
        expect(isInterfaceLane(event)).toBe(false);
      });
    });
  });

  describe('isInterfaceFunction', () => {
    it('should return true for RouteUserMessage', () => {
      expect(isInterfaceFunction('RouteUserMessage')).toBe(true);
    });

    it('should return true for CreateToolResponse', () => {
      expect(isInterfaceFunction('CreateToolResponse')).toBe(true);
    });

    it('should return false for planning functions', () => {
      expect(isInterfaceFunction('PlanNeo4jOperation')).toBe(false);
      expect(isInterfaceFunction('PlanWebSearch')).toBe(false);
      expect(isInterfaceFunction('ExecuteMCPScript')).toBe(false);
    });
  });

  describe('getEventLabel', () => {
    it('should return short label for BAML functions', () => {
      const event: TimelineEvent = { ...mockBAMLCall, lane: 'interface' };
      expect(getEventLabel(event)).toBe('Route');
    });

    it('should return label for tool calls', () => {
      const event: TimelineEvent = { ...mockToolCall, lane: 'tools' };
      expect(getEventLabel(event)).toBe('Read Cypher');
    });
  });

  describe('getEventDuration', () => {
    it('should return latency_ms for interface lane events', () => {
      const event: TimelineEvent = { ...mockBAMLCall, lane: 'interface' };
      expect(getEventDuration(event)).toBe(250);
    });

    it('should return duration_ms for tools lane events', () => {
      const event: TimelineEvent = { ...mockToolCall, lane: 'tools' };
      expect(getEventDuration(event)).toBe(120);
    });
  });

  describe('getEventHexColor', () => {
    it('should return cyber-500 hex for interface lane', () => {
      const event: TimelineEvent = { ...mockBAMLCall, lane: 'interface' };
      expect(getEventHexColor(event)).toBe('#6366f1');
    });

    it('should return namespace hex color for tool events', () => {
      const neo4jEvent: TimelineEvent = { ...mockToolCall, lane: 'tools' };
      expect(getEventHexColor(neo4jEvent)).toBe('#00ffff');

      const webSearchEvent: TimelineEvent = {
        ...mockToolCall,
        namespace: 'web_search',
        toolName: 'search',
        lane: 'tools'
      };
      expect(getEventHexColor(webSearchEvent)).toBe('#9d00ff');
    });
  });

  describe('getBAMLFunctionLabel', () => {
    const cases: [BAMLFunctionName, string][] = [
      ['RouteUserMessage', 'Route'],
      ['PlanNeo4jOperation', 'Plan Neo4j'],
      ['PlanWebSearch', 'Plan Search'],
      ['ExecuteMCPScript', 'Execute Script'],
      ['EvaluateScriptOutput', 'Evaluate Output'],
      ['CreateToolResponse', 'Response']
    ];

    it.each(cases)('should return "%s" for %s', (name, expected) => {
      expect(getBAMLFunctionLabel(name)).toBe(expected);
    });
  });

  describe('getToolLabel', () => {
    const cases: [string, string][] = [
      ['read_neo4j_cypher', 'Read Cypher'],
      ['write_neo4j_cypher', 'Write Cypher'],
      ['get_neo4j_schema', 'Get Schema'],
      ['search', 'Web Search'],
      ['fetch', 'Fetch URL'],
      ['code-mode-kg-agent-executor', 'Run JS'],
      ['unknown_tool', 'unknown_tool'] // Falls back to tool name
    ];

    it.each(cases)('should return "%s" for %s', (toolName, expected) => {
      expect(getToolLabel(toolName)).toBe(expected);
    });
  });

  describe('getNamespaceFromTool', () => {
    it('should classify neo4j tools correctly', () => {
      expect(getNamespaceFromTool('read_neo4j_cypher')).toBe('neo4j');
      expect(getNamespaceFromTool('write_neo4j_cypher')).toBe('neo4j');
      expect(getNamespaceFromTool('get_neo4j_schema')).toBe('neo4j');
    });

    it('should classify web_search tools correctly', () => {
      expect(getNamespaceFromTool('search')).toBe('web_search');
      expect(getNamespaceFromTool('fetch')).toBe('web_search');
    });

    it('should default to code_mode for unknown tools', () => {
      expect(getNamespaceFromTool('custom_tool')).toBe('code_mode');
      expect(getNamespaceFromTool('code-mode-kg-agent-executor')).toBe('code_mode');
    });
  });

  describe('Color Mappings', () => {
    it('should have all namespace colors defined', () => {
      expect(namespaceColors.neo4j).toBe('neon-cyan');
      expect(namespaceColors.web_search).toBe('neon-purple');
      expect(namespaceColors.code_mode).toBe('neon-orange');
    });

    it('should have all namespace hex colors defined', () => {
      expect(namespaceHexColors.neo4j).toBe('#00ffff');
      expect(namespaceHexColors.web_search).toBe('#9d00ff');
      expect(namespaceHexColors.code_mode).toBe('#ff6600');
    });

    it('should have all status colors defined', () => {
      expect(statusColors.pending).toBe('neon-yellow');
      expect(statusColors.success).toBe('neon-green');
      expect(statusColors.error).toBe('red-500');
    });
  });
});
