# Knowledge Graph Agent - Development Roadmap

## Overview

This roadmap tracks the development of the knowledge graph agent system, which combines Neo4j, BAML (for LLM prompting), UTCP (Universal Tool Calling Protocol), and a modern SolidStart UI.

---

## Phase 1: Foundation ✅ COMPLETE

**Goal:** Establish core infrastructure and tooling

- [x] Environment configuration (dev vs docker endpoints)
- [x] BAML client setup with Groq + OpenAI fallback
- [x] BAML functions (ProcessUserMessage, InterpretGraphResults, ValidateWriteOperation)
- [x] BAML TypeScript client generation
- [x] UTCP client with MCP gateway integration
- [x] Neo4j to Cytoscape graph transformation utilities
- [x] Server-side architecture using SolidStart server functions (`"use server"`)
- [x] BAML dynamic imports to prevent client bundling of native modules

**Architecture Note:** API routes were replaced with SolidStart server functions. BAML must use dynamic imports (`await import()`) inside async functions to avoid bundling native `.node` modules for the client.

**Key Files:**
- `ui/src/lib/config/endpoints.ts` - Environment-aware endpoints
- `ui/baml_src/clients.baml` - Groq/OpenAI client config
- `ui/baml_src/agent.baml` - BAML agent functions
- `ui/src/lib/utcp/client.ts` - UTCP client with MCP integration
- `ui/src/lib/graph/transform.ts` - Neo4j → Cytoscape transformation
- `ui/src/lib/utcp-baml-agent/server.ts` - Server functions (replaced API routes)

---

## Phase 2: Core UI ✅ COMPLETE

**Goal:** Build essential UI components for graph visualization and chat

- [x] GraphVisualization component (Cytoscape.js integration)
  - Multiple layouts (force-directed, circle, grid, hierarchical)
  - Dark futuristic theme with neon accents
  - Interactive node/edge selection
  - Zoom and pan controls
- [x] SupportPanel with tabbed interface
  - Graph tab (active)
  - Observability tab (placeholder)
  - Actions tab (placeholder)
  - Documents tab (placeholder)
  - Tools tab (placeholder)
- [x] ChatInterface with agent integration
  - Message history
  - Typing indicators
  - Error handling
- [x] ChatMessages with inline write approval workflow
  - Approve/reject buttons for write operations
  - Tool call status tracking

**Key Files:**
- `ui/src/components/ark-ui/GraphVisualization.tsx`
- `ui/src/components/ark-ui/SupportPanel.tsx`
- `ui/src/components/ark-ui/ChatInterface.tsx`
- `ui/src/components/ark-ui/ChatMessages.tsx`
- `ui/src/routes/index.tsx` - Main layout with Splitter

---

## Phase 3: Agent System ✅ COMPLETE

**Goal:** Implement AI agent with BAML and UTCP integration

- [x] AgentOrchestrator (client-side, calls server functions)
- [x] BAML function integration
  - ProcessUserMessage: Main agent reasoning
  - InterpretGraphResults: Natural language result interpretation
  - ValidateWriteOperation: Safety checks for writes
- [x] Query execution flow
  - Read queries execute immediately
  - Write queries require user approval
  - Results transformed to graph elements
- [x] Conversation history management (Thread class with events)
- [x] Schema-aware query generation
- [x] Error handling and user feedback

**Key Files:**
- `ui/src/lib/utcp-baml-agent/orchestrator.ts` - Client-side orchestrator
- `ui/src/lib/utcp-baml-agent/server.ts` - Server functions (processAgentMessage, etc.)
- `ui/src/lib/utcp-baml-agent/agent.ts` - Agent loop (BAML reasoning)
- `ui/src/lib/utcp-baml-agent/state.ts` - Thread state management
- `ui/src/lib/utcp-baml-agent/tools.ts` - Tool handlers (UTCP calls)

**Architecture (12-Factor-Agents Pattern):**
```
User → ChatInterface → AgentOrchestrator → Server Functions → BAML Agent Loop
                              ↓                                    ↓
                    GraphVisualization (Cytoscape)           Tool Handlers → UTCP → Neo4j
```

**Note:** Uses SolidStart server functions (`"use server"`) instead of API routes.

---

## Phase 4: Tool Execution 📝 NOT STARTED

**Goal:** Enable agent to execute tools (Neo4j queries, web fetch, etc.)

**Current State:** Agent can chat and respond to messages, but tool execution is not connected. The BAML agent generates queries but they are NOT executed against Neo4j.

### What Exists (But Not Working)
- `tools.ts` has handlers (`handleReadCypher`, `handleWriteCypher`, etc.)
- `agent.ts` calls these handlers but connection may be broken
- `lib/utcp/client.ts` has UTCP client configured for MCP gateway
- Tool wrappers exist: `KGTools`, `WebTools`, `N8nTools`

### What's Missing
- [ ] Verify MCP Gateway is running and accessible
- [ ] Debug tool execution flow: `BAML → Tool Handlers → UTCP → MCP → Neo4j`
- [ ] Test `KGTools.readCypher()` and `KGTools.getSchema()` directly
- [ ] Ensure UTCP client connects to MCP gateway properly

### Tasks to Complete
- [ ] Debug and fix tool execution chain
- [ ] Add logging to trace tool calls
- [ ] Test read queries end-to-end
- [ ] Test write queries with approval flow
- [ ] Verify graph data transforms correctly to Cytoscape elements

**Key Files:**
- `ui/src/lib/utcp-baml-agent/tools.ts` - Tool handlers (exist but may not work)
- `ui/src/lib/utcp/client.ts` - UTCP client with MCP config
- `ui/src/lib/config/endpoints.ts` - MCP gateway endpoint configuration

**Debug Steps:**
1. Check if MCP gateway is running (`localhost:3000` or Docker endpoint)
2. Test `getUtcpClient()` initialization
3. Test `KGTools.getSchema()` directly from a server function
4. Add console logs to `handleReadCypher()` to trace execution

---

## Phase 5: Neo4j Direct Integration ✅ COMPLETE

**Goal:** Use neo4j-driver for direct Neo4j operations, reserve UTCP for agentic workflows

### Completed
- [x] neo4j-driver installed and configured
- [x] Neo4j connection manager with environment-aware endpoints
- [x] Direct schema fetching via native Cypher queries
- [x] Server functions for Neo4j operations (getSchema, executeCypher)
- [x] Manual Cypher input in GraphVisualization component
- [x] Graph data transformation (Neo4j → Cytoscape elements)

**Architecture:**
```
Non-Agentic (Direct):  lib/neo4j/client.ts → neo4j-driver → Neo4j
Agentic (UTCP):        lib/utcp/client.ts → MCP Gateway → Neo4j (Phase 4)
```

**Key Files:**
- `ui/src/lib/neo4j/client.ts` - Direct Neo4j driver client
- `ui/src/lib/neo4j/queries.ts` - Server functions (getSchema, executeCypher)
- `ui/src/lib/graph/transform.ts` - Neo4j → Cytoscape transformation

---

## Phase 6: Observability 📝 PLANNED

**Goal:** Monitor and analyze BAML function performance

### Tasks
- [ ] PromptStats component
  - Display BAML function calls
  - Token usage tracking (input/output)
  - Latency metrics
  - Success/error rates
- [ ] BAML telemetry integration
  - Capture function execution metadata
  - Store in-memory or localStorage
  - Export capabilities
- [ ] Observability tab implementation
  - Real-time metrics display
  - Historical trend charts
  - Function-level breakdown
- [ ] Performance optimization insights
  - Identify slow prompts
  - Token usage optimization suggestions

**Key Files (To Create):**
- `ui/src/components/ark-ui/PromptStats.tsx`
- `ui/src/lib/telemetry/baml-tracker.ts`

---

## Phase 7: Advanced Features 📝 PLANNED

**Goal:** Complete the support panel with advanced capabilities

### Actions Panel
- [ ] Context-based action suggestions
- [ ] n8n workflow trigger UI
  - List available workflows
  - Manual trigger with parameters
  - Webhook configuration
- [ ] File operation actions
  - Upload to knowledge graph
  - Export graph data

### Documents Panel
- [ ] File upload interface
- [ ] Google Drive integration (optional)
- [ ] Document context management
- [ ] RAG (Retrieval-Augmented Generation) integration

### Tools Panel
- [ ] Tool selector UI
  - Display discovered tools
  - Enable/disable toggles
  - Authentication status indicators
- [ ] Code-mode composition
  - Create custom tool chains
  - Save/load tool compositions

**Key Files (To Create):**
- `ui/src/components/ark-ui/ActionsPanel.tsx`
- `ui/src/components/ark-ui/DocumentsPanel.tsx`
- `ui/src/components/ark-ui/ToolsPanel.tsx`

---

## Phase 8: Polish & Documentation 📝 PLANNED

**Goal:** Production readiness and comprehensive documentation

### Code Quality
- [ ] Fix ESLint errors
  - 39 `@typescript-eslint/no-explicit-any` errors
  - 3 unused variable warnings
  - Solid.js reactivity warnings
- [ ] TypeScript strict mode compliance
- [ ] Add comprehensive error boundaries
- [ ] Performance optimization
  - Lazy loading components
  - Debounce graph updates
  - Optimize BAML token usage

### Documentation
- [ ] Update UI_ARCHITECTURE.md
  - BAML integration details
  - UTCP tool calling patterns
  - Agent orchestration flow
  - Support panel architecture
- [ ] Create AGENT_ARCHITECTURE.md
  - BAML function design
  - Prompt engineering patterns
  - Tool discovery system
  - Safety and validation
- [ ] Update README.md with UI section
  - Setup instructions
  - Environment configuration
  - Development workflow
  - Deployment guide

### Testing
- [ ] Test with live Neo4j data
- [ ] End-to-end agent workflows
- [ ] Graph visualization performance testing
- [ ] Cross-browser compatibility
- [ ] Docker deployment verification

---

## Future Refinements 🔮

**Areas for Continuous Improvement:**

### UX Enhancements
- [ ] Keyboard shortcuts
- [ ] Command palette
- [ ] Customizable themes
- [ ] Graph layout persistence
- [ ] Conversation export/import

### Performance
- [ ] Virtual scrolling for large graphs
- [ ] WebWorkers for graph layout
- [ ] Streaming BAML responses
- [ ] Optimistic UI updates

### Security
- [ ] Audit BAML prompts for injection risks
- [ ] Cypher query sanitization
- [ ] Rate limiting for API routes
- [ ] Secrets management improvements

### Advanced Features
- [ ] Multi-user collaboration
- [ ] Graph diffing and versioning
- [ ] Temporal queries (time-based graph exploration)
- [ ] Custom BAML function editor
- [ ] Plugin system for custom tools

---

## Dependencies & Prerequisites

### Installed Packages
- `@boundaryml/baml` - BAML for LLM prompting
- `@utcp/sdk`, `@utcp/code-mode`, `@utcp/mcp` - UTCP for tool calling
- `cytoscape` - Graph visualization
- `neo4j-driver` - Direct Neo4j connection (added by user)
- `@ark-ui/solid` - Headless UI components
- `@solidjs/start` - SolidJS framework

### External Services
- Neo4j database (via Docker or cloud)
- MCP Gateway (running on port 3000)
- n8n (optional, for workflow automation)

### Environment Variables
- `GROQ_API_KEY` - For Groq LLM inference
- `OPENAI_API_KEY` - Fallback LLM
- Neo4j credentials (for direct driver connection)
- Additional tool-specific API keys (managed via EnvVarManager)

---

## Current Status

**What Works:**
✅ UI loads and renders correctly
✅ Agent responds to chat messages via BAML
✅ BAML generates Cypher queries based on user intent
✅ Conversation history maintained (Thread events)
✅ Graph visualization with Cytoscape.js
✅ Direct Neo4j queries via manual Cypher input
✅ Schema fetching via neo4j-driver

**What Does NOT Work (Yet):**
❌ Agent cannot execute tools (queries not sent to Neo4j)
❌ Read queries do not return data to graph visualization
❌ Write approval flow untested end-to-end
❌ UTCP → MCP → Neo4j connection not verified

**What's Next:**
📝 Tool execution (Phase 4) - Debug and connect tool handlers
📝 Observability panel (Phase 6)
📝 Advanced features (Phase 7)

**Known Issues:**
- BAML requires dynamic imports (no top-level imports in server-bundled code)
- UTCP client may not connect to MCP gateway (needs debugging)
- Tool handlers exist but execution chain is broken

---

## Contributing

When working on this project:

1. **Update this roadmap** - Check off completed items, add new discoveries
2. **Follow the phase order** - Each phase builds on the previous
3. **Document architectural decisions** - Update relevant docs in `docs/`
4. **Test thoroughly** - Especially BAML functions and graph transformations
5. **Keep it modular** - Maintain clear separation between client/server/agent layers

---

**Last Updated:** 2025-11-26
**Version:** 0.1.0-alpha
**Status:** Active Development - Phase 4 (Tool Execution) Not Started
