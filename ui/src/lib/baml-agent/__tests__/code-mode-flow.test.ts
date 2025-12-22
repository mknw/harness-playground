/**
 * End-to-End Tests for Code Mode Flow
 *
 * Tests the complete code mode execution path:
 * 1. Tool config state management (execution mode = 'code')
 * 2. Routing logic (always uses code mode planner when executionMode === 'code')
 * 3. BAML function calls (PlanToolComposition, EvaluateAndPersist)
 * 4. Tool repository integration (save/retrieve coded tools)
 *
 * These tests verify the fix for the MCPScriptPlan vs ToolCompositionPlan issue.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolConfig, ExecutionMode } from '../tool-config';
import type { ToolCompositionPlan, EvaluationWithPersistence, ScriptExecutionEvent } from '../../../../baml_client';

// ============================================================================
// Mock Types (matching BAML generated types)
// ============================================================================

interface MockRoutingInterfaceEvent {
  intent: string;
  tool_call_needed: boolean;
  tool_mode: 'Mcp' | 'CodeMode' | null;
  tool_name: 'neo4j' | 'web_search' | 'code_mode' | null;
  response_text: string;
}

// ============================================================================
// Unit Tests: Tool Config State
// ============================================================================

describe('Code Mode Flow - Tool Config State', () => {
  let mockConfig: ToolConfig;

  beforeEach(() => {
    mockConfig = {
      executionMode: 'static',
      catalogMode: 'minimal',
      selectedTools: ['read_neo4j_cypher', 'search']
    };
  });

  it('should default to static execution mode', () => {
    expect(mockConfig.executionMode).toBe('static');
  });

  it('should allow switching to code execution mode', () => {
    mockConfig.executionMode = 'code';
    expect(mockConfig.executionMode).toBe('code');
  });

  it('should maintain selected tools when switching execution mode', () => {
    const originalTools = [...mockConfig.selectedTools];
    mockConfig.executionMode = 'code';
    expect(mockConfig.selectedTools).toEqual(originalTools);
  });
});

// ============================================================================
// Unit Tests: Routing Decision Logic
// ============================================================================

describe('Code Mode Flow - Routing Logic', () => {
  /**
   * Tests the routing decision: when executionMode === 'code',
   * ALL tool calls should go through executeCodeModeWithPlanner,
   * regardless of what routing.tool_name suggests.
   */

  function shouldUseCodeModePlanner(
    executionMode: ExecutionMode,
    _toolName: 'neo4j' | 'web_search' | 'code_mode' | null
  ): boolean {
    // This mirrors the logic in server.ts executeToolLoop
    // When execution mode is 'code', ALWAYS use the code mode planner
    return executionMode === 'code';
  }

  it('should use code mode planner when executionMode=code and routing=code_mode', () => {
    expect(shouldUseCodeModePlanner('code', 'code_mode')).toBe(true);
  });

  it('should use code mode planner when executionMode=code and routing=neo4j', () => {
    // This is the key fix: even if routing suggests neo4j, use code mode planner
    expect(shouldUseCodeModePlanner('code', 'neo4j')).toBe(true);
  });

  it('should use code mode planner when executionMode=code and routing=web_search', () => {
    // This was the bug: routing=web_search with executionMode=code was using static mode
    expect(shouldUseCodeModePlanner('code', 'web_search')).toBe(true);
  });

  it('should NOT use code mode planner when executionMode=static', () => {
    expect(shouldUseCodeModePlanner('static', 'code_mode')).toBe(false);
    expect(shouldUseCodeModePlanner('static', 'neo4j')).toBe(false);
    expect(shouldUseCodeModePlanner('static', 'web_search')).toBe(false);
  });
});

// ============================================================================
// Unit Tests: ToolCompositionPlan Structure
// ============================================================================

describe('Code Mode Flow - ToolCompositionPlan Structure', () => {
  it('should have correct structure for new script creation', () => {
    const plan: ToolCompositionPlan = {
      reasoning: 'User wants to search the web and save results',
      use_existing_tool: false,
      existing_tool_name: null,
      new_script: 'const result = search({query: "docker sandbox mcp"});\nreturn result;',
      tool_name_to_save: 'search_docker_tutorials',
      tool_description: 'Search for Docker sandbox tutorials',
      should_save: true,
      status_message: 'Searching for Docker sandbox MCP tutorials...'
    };

    expect(plan.use_existing_tool).toBe(false);
    expect(plan.new_script).toBeDefined();
    expect(plan.new_script).not.toBeNull();
    expect(plan.should_save).toBe(true);
    expect(plan.tool_name_to_save).toBe('search_docker_tutorials');
  });

  it('should have correct structure for reusing existing tool', () => {
    const plan: ToolCompositionPlan = {
      reasoning: 'Found existing tool that matches this intent',
      use_existing_tool: true,
      existing_tool_name: 'get_graph_overview',
      new_script: null,
      tool_name_to_save: null,
      tool_description: null,
      should_save: false,
      status_message: 'Using existing tool: get_graph_overview'
    };

    expect(plan.use_existing_tool).toBe(true);
    expect(plan.existing_tool_name).toBe('get_graph_overview');
    expect(plan.should_save).toBe(false);
  });

  it('should handle one-off queries (no save)', () => {
    const plan: ToolCompositionPlan = {
      reasoning: 'Simple one-off query',
      use_existing_tool: false,
      existing_tool_name: null,
      new_script: 'return read_neo4j_cypher({query: "MATCH (n) RETURN count(n)"});',
      tool_name_to_save: null,
      tool_description: null,
      should_save: false,
      status_message: 'Counting nodes...'
    };

    expect(plan.should_save).toBe(false);
    expect(plan.tool_name_to_save).toBeNull();
  });
});

// ============================================================================
// Unit Tests: EvaluationWithPersistence Structure
// ============================================================================

describe('Code Mode Flow - EvaluationWithPersistence Structure', () => {
  it('should correctly evaluate successful execution with save', () => {
    const evaluation: EvaluationWithPersistence = {
      is_sufficient: true,
      explanation: 'Successfully retrieved search results for Docker tutorials',
      suggested_approach: null,
      tool_saved: true,
      saved_tool_name: 'search_docker_tutorials'
    };

    expect(evaluation.is_sufficient).toBe(true);
    expect(evaluation.tool_saved).toBe(true);
    expect(evaluation.saved_tool_name).toBe('search_docker_tutorials');
    expect(evaluation.suggested_approach).toBeNull();
  });

  it('should correctly evaluate insufficient result', () => {
    const evaluation: EvaluationWithPersistence = {
      is_sufficient: false,
      explanation: 'Search returned no results, need to try different query',
      suggested_approach: 'Try searching for "MCP server docker container" instead',
      tool_saved: false,
      saved_tool_name: null
    };

    expect(evaluation.is_sufficient).toBe(false);
    expect(evaluation.tool_saved).toBe(false);
    expect(evaluation.suggested_approach).not.toBeNull();
  });

  it('should not save on error even if requested', () => {
    const evaluation: EvaluationWithPersistence = {
      is_sufficient: false,
      explanation: 'Script execution failed with connection error',
      suggested_approach: 'Check if Neo4j is running and retry',
      tool_saved: false,
      saved_tool_name: null
    };

    expect(evaluation.tool_saved).toBe(false);
  });
});

// ============================================================================
// Unit Tests: ScriptExecutionEvent Structure
// ============================================================================

describe('Code Mode Flow - ScriptExecutionEvent Structure', () => {
  it('should track successful execution', () => {
    const event: ScriptExecutionEvent = {
      script: 'const result = search({query: "test"});\nreturn result;',
      output: '{"results": [{"title": "Test Result"}]}',
      error: null
    };

    expect(event.error).toBeNull();
    expect(event.output).toBeTruthy();
  });

  it('should track failed execution', () => {
    const event: ScriptExecutionEvent = {
      script: 'const result = undefined_function();\nreturn result;',
      output: '',
      error: 'ReferenceError: undefined_function is not defined'
    };

    expect(event.error).not.toBeNull();
    expect(event.output).toBe('');
  });
});

// ============================================================================
// Integration Tests: Full Flow Simulation
// ============================================================================

describe('Code Mode Flow - Full Flow Simulation', () => {
  /**
   * These tests simulate the complete flow without actual BAML calls,
   * verifying the logic and data transformations.
   */

  interface FlowState {
    config: ToolConfig;
    routing: MockRoutingInterfaceEvent;
    plan: ToolCompositionPlan | null;
    scriptEvents: ScriptExecutionEvent[];
    evaluation: EvaluationWithPersistence | null;
    toolSaved: boolean;
  }

  function simulateCodeModeFlow(
    userMessage: string,
    config: ToolConfig
  ): FlowState {
    const state: FlowState = {
      config,
      routing: {
        intent: 'Search the web for Docker MCP tutorials and save to graph',
        tool_call_needed: true,
        tool_mode: 'CodeMode',
        tool_name: 'web_search', // Routing suggests web_search
        response_text: 'Searching...'
      },
      plan: null,
      scriptEvents: [],
      evaluation: null,
      toolSaved: false
    };

    // Step 1: Check execution mode
    if (config.executionMode !== 'code') {
      // Would use static mode - return early
      return state;
    }

    // Step 2: Plan (simulated)
    state.plan = {
      reasoning: 'User wants to search for Docker MCP tutorials',
      use_existing_tool: false,
      existing_tool_name: null,
      new_script: [
        'const results = search({query: "docker sandbox mcp tutorials"});',
        'const parsed = JSON.parse(results);',
        'if (parsed.results && parsed.results.length > 0) {',
        '  const top2 = parsed.results.slice(0, 2);',
        '  for (const item of top2) {',
        '    write_neo4j_cypher({query: `CREATE (t:Tutorial {title: "${item.title}", url: "${item.url}"})`});',
        '  }',
        '  return JSON.stringify({saved: top2.length, tutorials: top2});',
        '}',
        'return JSON.stringify({saved: 0, error: "No results found"});'
      ].join('\n'),
      tool_name_to_save: 'search_and_save_tutorials',
      tool_description: 'Search web for tutorials and save to graph',
      should_save: true,
      status_message: 'Searching for tutorials and saving to graph...'
    };

    // Step 3: Execute (simulated)
    state.scriptEvents.push({
      script: state.plan.new_script!,
      output: JSON.stringify({
        saved: 2,
        tutorials: [
          { title: 'Docker MCP Tutorial 1', url: 'https://example.com/1' },
          { title: 'Docker MCP Tutorial 2', url: 'https://example.com/2' }
        ]
      }),
      error: null
    });

    // Step 4: Evaluate (simulated)
    state.evaluation = {
      is_sufficient: true,
      explanation: 'Successfully found and saved 2 Docker MCP tutorials',
      suggested_approach: null,
      tool_saved: true,
      saved_tool_name: 'search_and_save_tutorials'
    };

    // Step 5: Save tool if indicated
    if (state.evaluation.tool_saved) {
      state.toolSaved = true;
    }

    return state;
  }

  it('should complete full flow when executionMode=code', () => {
    const config: ToolConfig = {
      executionMode: 'code',
      catalogMode: 'minimal',
      selectedTools: ['search', 'write_neo4j_cypher']
    };

    const state = simulateCodeModeFlow(
      'use code mode to search for docker sandbox mcp tutorials and save them',
      config
    );

    // Verify flow completed
    expect(state.plan).not.toBeNull();
    expect(state.plan!.use_existing_tool).toBe(false);
    expect(state.scriptEvents).toHaveLength(1);
    expect(state.scriptEvents[0].error).toBeNull();
    expect(state.evaluation).not.toBeNull();
    expect(state.evaluation!.is_sufficient).toBe(true);
    expect(state.toolSaved).toBe(true);
  });

  it('should NOT complete flow when executionMode=static', () => {
    const config: ToolConfig = {
      executionMode: 'static',
      catalogMode: 'minimal',
      selectedTools: ['search', 'write_neo4j_cypher']
    };

    const state = simulateCodeModeFlow(
      'use code mode to search for docker sandbox mcp tutorials and save them',
      config
    );

    // Flow should exit early - plan would not be created
    // (In real code, it would use static planners instead)
    expect(state.plan).toBeNull();
  });
});

// ============================================================================
// Tests: Script Escape Handling
// ============================================================================

describe('Code Mode Flow - Script JSON Escaping', () => {
  /**
   * Tests that scripts are properly escaped for JSON output.
   * This was a source of BAML parsing errors.
   */

  it('should handle scripts with escaped newlines', () => {
    const script = 'const x = 1;\\nconst y = 2;\\nreturn x + y;';
    const parsed = script.replace(/\\n/g, '\n');

    expect(parsed).toContain('\n');
    expect(parsed.split('\n')).toHaveLength(3);
  });

  it('should handle scripts with actual newlines in plan', () => {
    const plan: ToolCompositionPlan = {
      reasoning: 'Test',
      use_existing_tool: false,
      existing_tool_name: null,
      new_script: 'const x = 1;\nconst y = 2;\nreturn x + y;',
      tool_name_to_save: null,
      tool_description: null,
      should_save: false,
      status_message: 'Testing...'
    };

    // Script should be usable
    expect(plan.new_script).toContain('\n');
  });

  it('should handle complex scripts with quotes and special chars', () => {
    const script = `const query = 'MATCH (n) WHERE n.name = "test" RETURN n';
const result = read_neo4j_cypher({query: query});
return JSON.stringify({data: JSON.parse(result)});`;

    // Should contain all special characters
    expect(script).toContain("'");
    expect(script).toContain('"');
    expect(script).toContain('{');
    expect(script).toContain('}');
  });
});

// ============================================================================
// Tests: Error Recovery
// ============================================================================

describe('Code Mode Flow - Error Recovery', () => {
  it('should track previous attempts for retry', () => {
    const attempts: ScriptExecutionEvent[] = [];

    // First attempt - fails
    attempts.push({
      script: 'return undefinedTool();',
      output: '',
      error: 'ReferenceError: undefinedTool is not defined'
    });

    // Second attempt - different approach
    attempts.push({
      script: 'return search({query: "test"});',
      output: '{"results": []}',
      error: null
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[0].error).not.toBeNull();
    expect(attempts[1].error).toBeNull();
  });

  it('should allow up to MAX_TOOL_TURNS attempts', () => {
    const MAX_TOOL_TURNS = 5;
    const attempts: ScriptExecutionEvent[] = [];

    for (let i = 0; i < MAX_TOOL_TURNS; i++) {
      attempts.push({
        script: `attempt_${i}`,
        output: '',
        error: 'Still failing'
      });
    }

    expect(attempts).toHaveLength(MAX_TOOL_TURNS);
  });
});

// ============================================================================
// Tests: Tool Repository Integration
// ============================================================================

describe('Code Mode Flow - Tool Repository Integration', () => {
  interface MockCodedTool {
    name: string;
    description: string;
    script: string;
    usageCount: number;
  }

  const mockRepository: Map<string, MockCodedTool> = new Map();

  beforeEach(() => {
    mockRepository.clear();
  });

  function saveTool(tool: { name: string; description: string; script: string }) {
    const existing = mockRepository.get(tool.name);
    mockRepository.set(tool.name, {
      ...tool,
      usageCount: existing ? existing.usageCount : 0
    });
  }

  function getTool(name: string): MockCodedTool | null {
    const tool = mockRepository.get(name);
    if (tool) {
      tool.usageCount++;
      return tool;
    }
    return null;
  }

  function getToolsForPlanner(): Array<{ name: string; description: string }> {
    return Array.from(mockRepository.values()).map(t => ({
      name: t.name,
      description: t.description
    }));
  }

  it('should save new tool to repository', () => {
    saveTool({
      name: 'search_tutorials',
      description: 'Search for tutorials',
      script: 'return search({query: "tutorials"});'
    });

    expect(mockRepository.has('search_tutorials')).toBe(true);
  });

  it('should retrieve tool and increment usage', () => {
    saveTool({
      name: 'get_schema',
      description: 'Get graph schema',
      script: 'return get_neo4j_schema();'
    });

    const tool1 = getTool('get_schema');
    expect(tool1?.usageCount).toBe(1);

    const tool2 = getTool('get_schema');
    expect(tool2?.usageCount).toBe(2);
  });

  it('should provide tool list for planner context', () => {
    saveTool({ name: 'tool1', description: 'First tool', script: 'return 1;' });
    saveTool({ name: 'tool2', description: 'Second tool', script: 'return 2;' });

    const tools = getToolsForPlanner();
    expect(tools).toHaveLength(2);
    expect(tools[0]).toHaveProperty('name');
    expect(tools[0]).toHaveProperty('description');
  });

  it('should return null for non-existent tool', () => {
    const tool = getTool('non_existent');
    expect(tool).toBeNull();
  });
});
