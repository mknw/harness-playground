/**
 * Tests for Tool Configuration Module
 *
 * Tests the tool configuration state management including:
 * - Execution mode (static/code)
 * - Catalog mode (minimal/global)
 * - Tool selection
 */

import { describe, it, expect } from 'vitest';
import {
  getMinimalTools,
  MINIMAL_TOOLS,
  type ExecutionMode,
  type CatalogMode,
  type ToolConfig
} from '../tool-config';

describe('tool-config', () => {
  describe('getMinimalTools', () => {
    it('should return the default minimal tools', () => {
      const tools = getMinimalTools();

      expect(tools).toContain('read_neo4j_cypher');
      expect(tools).toContain('write_neo4j_cypher');
      expect(tools).toContain('get_neo4j_schema');
      expect(tools).toContain('search');
      expect(tools).toContain('fetch_content');
      expect(tools).toHaveLength(5);
    });

    it('should return a new array each time (not a reference)', () => {
      const tools1 = getMinimalTools();
      const tools2 = getMinimalTools();

      expect(tools1).not.toBe(tools2);
      expect(tools1).toEqual(tools2);
    });
  });

  describe('MINIMAL_TOOLS constant', () => {
    it('should match getMinimalTools()', () => {
      expect(MINIMAL_TOOLS).toEqual(getMinimalTools());
    });

    it('should include Neo4j tools', () => {
      expect(MINIMAL_TOOLS).toContain('read_neo4j_cypher');
      expect(MINIMAL_TOOLS).toContain('write_neo4j_cypher');
      expect(MINIMAL_TOOLS).toContain('get_neo4j_schema');
    });

    it('should include web tools', () => {
      expect(MINIMAL_TOOLS).toContain('search');
      expect(MINIMAL_TOOLS).toContain('fetch_content');
    });
  });

  describe('Type definitions', () => {
    it('should allow valid ExecutionMode values', () => {
      const staticMode: ExecutionMode = 'static';
      const codeMode: ExecutionMode = 'code';

      expect(staticMode).toBe('static');
      expect(codeMode).toBe('code');
    });

    it('should allow valid CatalogMode values', () => {
      const minimal: CatalogMode = 'minimal';
      const global: CatalogMode = 'global';

      expect(minimal).toBe('minimal');
      expect(global).toBe('global');
    });

    it('should allow valid ToolConfig objects', () => {
      const config: ToolConfig = {
        executionMode: 'static',
        catalogMode: 'minimal',
        selectedTools: ['read_neo4j_cypher']
      };

      expect(config.executionMode).toBe('static');
      expect(config.catalogMode).toBe('minimal');
      expect(config.selectedTools).toHaveLength(1);
    });
  });
});
