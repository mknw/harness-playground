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
- `ui/baml_src/routing.baml` - Message routing and intent detection
- `ui/baml_src/neo4j.baml` - Neo4j query planning
- `ui/baml_src/code_mode.baml` - Code mode tool composition
- `ui/src/lib/graph/transform.ts` - Neo4j → Cytoscape transformation
- `ui/src/lib/baml-agent/server.ts` - Server functions (replaced API routes)

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
- `ui/src/lib/baml-agent/orchestrator.ts` - Client-side orchestrator
- `ui/src/lib/baml-agent/server.ts` - Server functions (processAgentMessage, etc.)
- `ui/src/lib/baml-agent/agent.ts` - Tool execution integration layer
- `ui/src/lib/baml-agent/state.ts` - Thread state management
- `ui/src/lib/baml-agent/mcp-client.ts` - MCP SDK client wrapper

**Architecture (12-Factor-Agents Pattern):**
```
User → ChatInterface → AgentOrchestrator → Server Functions → BAML Agent Loop
                              ↓                                    ↓
                    GraphVisualization (Cytoscape)           Tool Handlers → UTCP → Neo4j
```

**Note:** Uses SolidStart server functions (`"use server"`) instead of API routes.

---

## Phase 4: Tool Execution 🔧 IN PROGRESS

**Goal:** Enable agent to execute tools (Neo4j queries, web fetch, etc.)

### Implemented
- [x] Multi-turn tool loop with MAX_TOOL_TURNS = 5
- [x] Namespace-specific planning (neo4j, web_search, code_mode)
- [x] Direct neo4j-driver for Neo4j operations (bypassing MCP for reliability)
- [x] MCP Gateway integration for web_search and fetch tools
- [x] SSE response parsing for MCP Gateway streaming transport
- [x] Tool routing classification (RouteUserMessage BAML function)
- [x] Approval system for write operations (one_time, thread, tool_based)
- [x] Token management with context pruning at 8000 tokens

### Needs Debugging
- [ ] Some tools fail during execution - investigate error handling
- [ ] Tool routing may misclassify certain user intents
- [ ] End-to-end testing for all tool namespaces
- [ ] Error recovery and retry logic

### Architecture

```
BAML Agent → Tool Loop → Namespace Router
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌──────────┐    ┌──────────┐    ┌──────────┐
       │ neo4j    │    │web_search│    │code_mode │
       │(direct)  │    │(MCP 8811)│    │(MCP 8811)│
       └──────────┘    └──────────┘    └──────────┘
```

**Key Files:**
- `ui/src/lib/baml-agent/server.ts` - SSE parsing, MCP Gateway calls, executeToolLoop
- `ui/src/lib/baml-agent/mcp-client.ts` - MCP SDK client with callTool wrapper
- `ui/baml_src/routing.baml` - Routing rules for tool selection

---

## Phase 4.1: Code Mode Flow Optimization 📝 PLANNED

**Goal:** Optimize the code mode execution flow for reliability and observability

### Task 1: Evaluator Loop Prevention
- [ ] Add MAX_EVALUATION_RETRIES limit to prevent infinite loops
- [ ] Implement exponential backoff for retry attempts
- [ ] Add "give up gracefully" logic after N failed attempts
- [ ] Track evaluation history to detect repeated failures

### Task 2: Intermediate Logging for Evaluator
- [ ] Log script execution output at each turn
- [ ] Capture and store intermediate results for evaluation context
- [ ] Add structured logging for debugging failed scripts
- [ ] Emit telemetry events for each evaluation decision

### Task 3: Context Management for Previous Attempts
- [ ] Provide rich context about previous errors to evaluator
- [ ] Include script diff between attempts
- [ ] Summarize what was tried and what failed
- [ ] Limit context size to prevent token overflow

### Task 4: Tools Panel Global Catalog
- [ ] Fix global catalog showing only 11 tools (should show 50+)
- [ ] Implement tool "Configure" button with overlay
  - MCP server description
  - Tool descriptions for each server
  - Credentials/parameters input (session-scoped)
- [ ] Store configuration in session state (not persisted)

### Task 5: Context Filtering for BAML Functions
- [ ] Audit each BAML function's context needs
- [ ] Implement event filtering in orchestrator.ts
- [ ] Create parametrized context builders per function type
- [ ] Ensure no function receives more context than needed

### Task 6: Type Consolidation
- [ ] Analyze `ProcessMessageOutput` (orchestrator.ts) vs `ProcessMessageResult` (server.ts)
- [ ] Determine if consolidation is appropriate or if layering is intentional
- [ ] Remove actual redundancies where found
- [ ] Document architectural decisions for type separation

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

## Phase 6: Observability ✅ PARTIAL - IMPROVEMENTS PLANNED

**Goal:** Monitor and analyze BAML function performance

### Completed
- [x] Vertical timeline with Interface/Tools lanes
- [x] BAML function telemetry with token usage tracking
- [x] Tool execution telemetry with namespace color coding
- [x] Real-time metrics display in Observability tab
- [x] EventDetailOverlay for inspecting event details
- [x] Aggregated metrics (total calls, success rate, avg latency, total tokens)

### Planned Improvements
- [ ] **EventDetailOverlay enhancements**
  - Add input parameters display for BAML functions
  - Show tool payloads in detail overlay
  - Display reasoning from planning functions
- [ ] **Parsed view improvements**
  - Collapsible sections for large JSON responses
  - Chip/tag UI for key-value pairs
  - Remove "```json" delimiter from Parsed view (only show in Raw)
- [ ] **Performance optimization insights**
  - Identify slow prompts
  - Token usage optimization suggestions
  - Historical trend charts

**Key Files:**
- `ui/src/lib/baml-agent/telemetry.ts` - Telemetry types and helpers
- `ui/src/lib/baml-agent/telemetry-store.ts` - State management for telemetry
- `ui/src/components/ark-ui/ObservabilityPanel.tsx` - Timeline display
- `ui/src/components/ark-ui/EventDetailOverlay.tsx` - Event detail view

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

### Documents Panel - Document Ingestion Feature
- [ ] **Documents tab UI**
  - File upload interface with drag-and-drop
  - Document list with status indicators
  - Preview panel for document contents
- [ ] **BAML media integration**
  - Use BAML media resources for document handling
  - Support PDF, image, and text file processing
  - Extract text and metadata from documents
- [ ] **Knowledge graph ingestion**
  - BAML function for document analysis
  - Entity extraction from document content
  - Relationship inference between entities
  - Automatic node/edge creation in Neo4j
- [ ] **Optional integrations**
  - Google Drive document import
  - URL content fetching and parsing
  - RAG (Retrieval-Augmented Generation) for document Q&A

### Tools Panel ✅ COMPLETE
- [x] Tool selector UI
  - Display discovered tools
  - Enable/disable toggles
  - Execution mode switch (Static/Code)
  - Catalog mode switch (Minimal/Global)
- [x] Code-mode composition
  - PlanToolComposition BAML function for tool planning
  - EvaluateAndPersist BAML function for evaluation and storage
  - Coded tools repository in Neo4j
  - Save/load tool compositions from repository

**Key Files:**
- `ui/src/components/ark-ui/ToolsPanel.tsx` ✅
- `ui/src/lib/baml-agent/tool-config.ts` ✅
- `ui/src/lib/baml-agent/tool-repository.ts` ✅
- `ui/baml_src/planner.baml` ✅
- `configs/mcp-config.yaml` - MCP Gateway configuration
- `configs/custom-catalog.yaml` - Minimal catalog
- `configs/catalog.yaml` - Full Docker MCP catalog

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
- Neo4j database (via Docker Compose, port 7687)
- MCP Gateway (via Docker Compose, port 8811)
- n8n (optional, for workflow automation, port 5678)

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
✅ Multi-turn tool loop architecture implemented
✅ SSE response parsing for MCP Gateway streaming transport
✅ Neo4j data versioning via Cypher dumps (scripts/)
✅ Observability panel with vertical timeline and telemetry
✅ code_mode with execute-evaluate loop (ExecuteMCPScript + EvaluateScriptOutput)
✅ MCP Gateway code-mode integration for JavaScript tool composition
✅ Tools tab with execution mode toggle (Static/Code)
✅ Catalog mode switching (Minimal/Global)
✅ Tool selection checkboxes with server-side state
✅ PlanToolComposition BAML function for code mode planning
✅ EvaluateAndPersist BAML function for evaluation + repository storage
✅ Coded tools repository in Neo4j (CodedTool nodes)
✅ Config files consolidated in configs/ directory

**What Needs Debugging:**
🔧 Some tools fail during execution - needs investigation
🔧 Tool routing classification may misroute certain requests
🔧 End-to-end tool execution flow needs testing
🔧 MCP Gateway hot-swap implementation (placeholder)

**What's Next:**
📝 Debug tool execution issues (Phase 4 refinement)
📝 Implement actual MCP Gateway hot-swap for catalog switching
📝 Observability improvements - inputs in detail overlay, collapsible parsed fields
📝 Document ingestion feature (Phase 7) - BAML media, entity extraction
📝 Advanced features (Phase 7) - Actions, Documents panels
📝 Code mode flow optimization (see Phase 4.1 below)
📝 Tools Panel enhancements - configure buttons, global catalog expansion
📝 Context management refactoring - reduce redundancy, optimize BAML inputs

**Known Issues:**
- BAML requires dynamic imports (no top-level imports in server-bundled code)
- MCP Gateway occasionally needs restart after config changes
- Import from APOC export format needs manual processing
- Tool execution has intermittent failures - debugging in progress
- LLM-based BAML tests are non-deterministic - some test failures are expected
- MCP Gateway hot-swap is placeholder - currently just updates local state

---

## Contributing

When working on this project:

1. **Update this roadmap** - Check off completed items, add new discoveries
2. **Follow the phase order** - Each phase builds on the previous
3. **Document architectural decisions** - Update relevant docs in `docs/`
4. **Test thoroughly** - Especially BAML functions and graph transformations
5. **Keep it modular** - Maintain clear separation between client/server/agent layers

---

**Last Updated:** 2025-12-22
**Version:** 0.4.2-alpha
**Status:** Active Development - Harness Patterns Framework Added
