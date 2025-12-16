/**
 * Tests for Tool Repository Module
 *
 * Tests the type definitions and interfaces for the coded tools repository.
 * Note: Integration tests with Neo4j should be run separately.
 */

import { describe, it, expect } from 'vitest';
import type {
  CodedTool,
  CodedToolReference,
  SaveCodedToolInput
} from '../tool-repository';

describe('tool-repository types', () => {
  describe('CodedTool interface', () => {
    it('should allow creating a valid CodedTool', () => {
      const tool: CodedTool = {
        name: 'test_tool',
        description: 'A test tool',
        script: 'return "hello";',
        createdAt: '2025-01-01T00:00:00Z',
        usageCount: 5
      };

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.script).toBe('return "hello";');
      expect(tool.createdAt).toBe('2025-01-01T00:00:00Z');
      expect(tool.usageCount).toBe(5);
      expect(tool.inputSchema).toBeUndefined();
      expect(tool.updatedAt).toBeUndefined();
    });

    it('should allow optional fields', () => {
      const tool: CodedTool = {
        name: 'full_tool',
        description: 'A fully specified tool',
        script: 'return JSON.stringify({});',
        inputSchema: '{"type": "object"}',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
        usageCount: 10
      };

      expect(tool.inputSchema).toBe('{"type": "object"}');
      expect(tool.updatedAt).toBe('2025-01-02T00:00:00Z');
    });
  });

  describe('CodedToolReference interface', () => {
    it('should contain only name and description', () => {
      const ref: CodedToolReference = {
        name: 'my_tool',
        description: 'Does something useful'
      };

      expect(ref.name).toBe('my_tool');
      expect(ref.description).toBe('Does something useful');
      // Should not have other fields
      expect(Object.keys(ref)).toEqual(['name', 'description']);
    });
  });

  describe('SaveCodedToolInput interface', () => {
    it('should have required fields for saving', () => {
      const input: SaveCodedToolInput = {
        name: 'new_tool',
        description: 'A new tool to save',
        script: 'const result = search({query: "test"}); return result;'
      };

      expect(input.name).toBe('new_tool');
      expect(input.description).toBe('A new tool to save');
      expect(input.script).toContain('search');
    });

    it('should allow optional inputSchema', () => {
      const input: SaveCodedToolInput = {
        name: 'typed_tool',
        description: 'A tool with input schema',
        script: 'return args.query;',
        inputSchema: '{"type": "object", "properties": {"query": {"type": "string"}}}'
      };

      expect(input.inputSchema).toBeDefined();
    });
  });

  describe('Tool naming conventions', () => {
    it('should use snake_case for tool names', () => {
      const validNames = [
        'search_and_save',
        'get_user_relationships',
        'count_all_nodes',
        'find_tech_stack'
      ];

      for (const name of validNames) {
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    it('should prefix with action verbs', () => {
      const validPrefixes = ['get_', 'find_', 'search_', 'count_', 'create_', 'update_', 'delete_'];
      const toolName = 'get_graph_overview';

      const hasValidPrefix = validPrefixes.some(prefix => toolName.startsWith(prefix));
      expect(hasValidPrefix).toBe(true);
    });
  });

  describe('Script format', () => {
    it('should be valid JavaScript that returns a string', () => {
      const scripts = [
        'return get_neo4j_schema();',
        'const result = search({query: "test"}); return result;',
        'return JSON.stringify({count: 5});',
        'const data = read_neo4j_cypher({query: "MATCH (n) RETURN n"}); return data;'
      ];

      for (const script of scripts) {
        // All scripts should contain a return statement
        expect(script).toContain('return');
      }
    });

    it('should use synchronous function calls (no async/await)', () => {
      const validScript = 'const result = search({query: "test"}); return result;';
      const invalidScript = 'const result = await search({query: "test"}); return result;';

      expect(validScript).not.toContain('await');
      expect(invalidScript).toContain('await');
    });
  });
});
