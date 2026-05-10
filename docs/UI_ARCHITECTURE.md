# UI Architecture Reference

> **Scope:** This document covers the `ui/` directory - the SolidJS frontend application.

Quick reference for the SolidJS frontend structure, configuration, and patterns.

---

## 1. Package Management & Core Dependencies

### Package Manager
- **pnpm** - Fast, disk space efficient package manager
- Node.js >= 22 required

### Core Stack
```json
{
  "framework": "@solidjs/start ^1.2.0",
  "router": "@solidjs/router ^0.15.3",
  "ui-library": "@ark-ui/solid ^5.26.2",
  "auth": "@stackframe/js ^2.8.48",
  "styling": "unocss ^66.5.4",
  "bundler": "vinxi ^0.5.8"
}
```

### ESLint Configuration
**File:** `ui/eslint.config.ts`

Key rules:
```typescript
{
  "prefer-const": "warn",
  "no-constant-binary-expression": "error",
  "@typescript-eslint/no-empty-object-type": ["error", {
    "allowInterfaces": "with-single-extends"  // Allows module augmentation
  }],
  "@typescript-eslint/no-unused-vars": ["error", {
    "varsIgnorePattern": "^_|^T$",  // Ignore _ and T (generic params)
    "argsIgnorePattern": "^_"
  }]
}
```

---

## 2. UnoCSS Configuration

### Setup Files
- **Config:** `ui/uno.config.ts`
- **TypeScript Shim:** `ui/src/shims.d.ts`

### Configuration
```typescript
defineConfig({
  presets: [
    presetAttributify(),    // Enables attribute-based styling
    presetWind4(),          // Tailwind v4-like utilities
    presetWebFonts({        // Google Fonts
      fonts: {
        sans: 'Inter',
        serif: 'Roboto Slab',
        mono: 'Fira Code'
      }
    })
  ],
  transformers: [
    transformerAttributifyJsx()  // JSX/TSX support
  ]
})
```

### Attributify Syntax
Enables attribute-based styling instead of `class`:

```tsx
// Traditional
<div class="flex items-center gap-2 bg-blue-500">

// Attributify
<div flex items-center gap-2 bg-blue-500>

// With variants
<button bg="blue-500 hover:blue-600" text="white sm">

// Grouped values
<div p="x-4 y-2" border="~ gray-200">

// Self-referencing with ~
<div border="~ red">  // = border border-red
```

### TypeScript Shim
**File:** `ui/src/shims.d.ts`

```typescript
import type { AttributifyAttributes } from '@unocss/preset-attributify'

declare module 'solid-js' {
  namespace JSX {
    interface HTMLAttributes<T> extends AttributifyAttributes {
      // Add custom utility types here if needed
      tracking?: string | boolean;
      leading?: string | boolean;
    }
  }
}
```

---

## 3. Authentication

### Architecture Overview
**Client-side:** `StackClientApp` (browser only)
**Server-side:** `getCurrentUser()` via Stack Auth cookies
**Email allowlist:** Controls access (`ui/src/lib/auth/allowList.ts`)

### Client Setup
**File:** `ui/src/lib/auth/client.ts`

```typescript
// Singleton pattern - lazy initialization
getStackClientApp() → StackClientApp

// Environment variables required:
VITE_STACK_PROJECT_ID
VITE_STACK_PUBLISHABLE_CLIENT_KEY

// URL configuration:
{
  signIn: '/auth/signin',
  signUp: '/auth/signup',
  oauthCallback: window.location.origin + '/auth/callback',
  afterSignOut: '/auth/signin'
}
```

### Server Validation
**File:** `ui/src/lib/auth/server.ts`

```typescript
// Use in server functions:
const user = await getAuthenticatedUser();
// → Returns: { id, email, displayName }
// → Throws if: not authenticated or email not in allowlist
```

### AuthProvider Component
**File:** `ui/src/components/AuthProvider.tsx`

Provides app-wide auth context:

```typescript
const { user, loading, refetch, signOut } = useAuth();

// Features:
// - Client-only resource fetching (no SSR issues)
// - Automatic redirect logic (auth ↔ protected routes)
// - Email allowlist enforcement
// - Loading states with branded spinner
```

**Redirect Logic:**
1. Authenticated user on `/auth/*` → redirect to `/`
2. Unauthenticated user on protected route → redirect to `/auth/signin`
3. User email not in allowlist → sign out + redirect to `/auth/access-denied`

---

## 4. User Avatar & Actions

### UserMenu Component
**File:** `ui/src/components/ark-ui/UserMenu.tsx`

Integration with Stack Auth via `useAuth()`:

```tsx
import { useAuth } from '~/components/AuthProvider'

const { user, signOut } = useAuth()

// Available user data:
user().profileImageUrl  // Avatar URL (nullable)
user().displayName      // Display name (nullable)
user().primaryEmail     // Email address (nullable)

// Sign out action:
await signOut()  // → Clears session, redirects to signin
```

**Component Structure:**
- **Ark UI Avatar:** Shows profile image or initials fallback
- **Ark UI Menu:** Dropdown with Profile Settings & Sign Out
- **Positioning:** Added to Nav via `<li class="ml-auto">`
- **Visibility:** Only shown when `user()` exists

**Usage in Nav:**
```tsx
// ui/src/components/Nav.tsx
import { UserMenu } from "~/components/ark-ui/UserMenu"

<nav class="bg-sky-800">
  <ul class="...">
    <li>Home</li>
    <li>About</li>
    <li class="ml-auto">
      <UserMenu />  {/* Auto-hides when logged out */}
    </li>
  </ul>
</nav>
```

---

## 5. Application Layout & Chat Interface

### Overall Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ Nav (dark-bg-secondary)                                 │
│  Home | About          [Theme] [Avatar Menu]            │
├────────────┬──────────────────────────┬─────────────────┤
│            │                          │                 │
│  Sidebar   │   Chat Messages          │  Support Panel  │
│  (64 cols) │   (ScrollArea)           │  (tabbed)       │
│            │                          │                 │
│  [History] │ ─────────────────────────│ Neo4j|Memory|   │
│  Thread 1  │   Chat Input             │ All|Observabi-  │
│  Thread 2  │   (Field.Textarea)       │ lity*|Tools     │
│  Thread 3  │                          │  (* default)    │
│            │                          │                 │
│ [+ New]    │                          │  [↓ Save]       │
└────────────┴──────────────────────────┴─────────────────┘
    ↑              ↑─── Splitter ───↑          ↑
Collapsible      60% default       40% default
```

### Main Page Component
**File:** `ui/src/routes/index.tsx`

```tsx
<Splitter.Root orientation="horizontal" defaultSize={[60, 40]}>
  <Splitter.Panel id="chat">
    <ChatInterface
      onGraphUpdate={accumulateGraphElements}
      onEventsUpdate={accumulateEvents}
      onContextUpdate={setUnifiedContext}
    />
  </Splitter.Panel>

  <Splitter.ResizeTrigger id="chat:support" />

  <Splitter.Panel id="support">
    <SupportPanel
      graphElements={graphElements()}
      contextEvents={contextEvents()}
      unifiedContext={unifiedContext()}
      onClearGraph={clearGraph}
      onClearEvents={clearEvents}
    />
  </Splitter.Panel>
</Splitter.Root>
```

### Chat Interface Components

**Location:** All in `ui/src/components/ark-ui/`

#### 1. ChatInterface.tsx
Main container combining sidebar and chat area:
```tsx
<div flex="~">
  <ChatSidebar />           // 64 columns wide
  <div flex="~ col 1">      // Flexible main area
    <ChatMessages />
    <ChatInput />
  </div>
</div>
```

#### 2. ChatSidebar.tsx
**Props:** `collapsed: boolean`, `onToggle: () => void`, `threads`, `selectedId`, `onSelectThread`, `onNewChat`
- Width: `3rem` (collapsed) → `16rem` (expanded)
- Smooth inline style transition
- Thread history with relative timestamps
- Settings gear icon (opens `SettingsPanel` FloatingPanel) + New Chat button in footer
- Content hidden when collapsed (toggle button only)
- **Optimistic "+ New Chat" placeholder (#44):** Clicking *+ New Chat* immediately prepends a placeholder row keyed by the new `selectedSessionId` (`title: null`, `isPlaceholder: true`, muted italic *"description will appear here"*). Once the first user message persists and the `threadsResource` refetch returns the real row, the merger (`mergeThreadsWithPlaceholder` in `ChatSidebar.tsx`) drops the placeholder by id. No DB writes for the placeholder — purely client-side. Switching to an existing thread clears it.

#### 3. ChatMessages.tsx
- **ScrollArea.Root** - Custom scrollable message container
- **Features:**
  - Auto-scroll to latest message
  - Different layouts for user vs assistant messages
  - Avatar with initials fallback
  - Message bubbles with timestamps
  - Empty state with icon
- **User messages:** Right-aligned, cyber-700 background
- **AI messages:** Left-aligned, dark-bg-tertiary background
- **Chat-Graph Entity Linking:** After rendering markdown, `annotateEntities()` post-processes the HTML to wrap known entity and relation names in `<span class="graph-entity" data-entity-name="..." data-entity-ids="...">` elements. Hovering highlights matching graph nodes/edges; clicking toggles a persistent highlight. A module-level `toggledEntities` Set tracks persistent state. Event delegation on the messages container handles all interactions via `handleMouseOver`, `handleMouseOut`, `handleClick`.
  - **Props:** `graphEntityNames?: Map<string, string[]>` (name → element IDs, built in `index.tsx` from graph elements), `onHighlightEntities?: (ids: string[]) => void`
  - **CSS:** `.graph-entity` styles in `uno.config.ts` (dashed underline, cyan glow on hover/toggle)

#### 4. ChatInput.tsx
- **Field.Textarea** with `autoresize` prop
- **Keyboard shortcuts:**
  - Enter → Send message
  - Shift+Enter → New line
- **Submit guard (#47):** When `disabled` is true, the textarea **stays editable** so the user's draft survives, but Enter no-ops. If `blockedMessage` is provided, an inline banner ("Waiting for `<tool>` to complete. Try later.") renders above the input — driven by the currently-running tool from the active session's `controller_action` events.
- **Styling:** Neon cyan border on focus

#### 5. AgentSelector.tsx
**Props:** `selectedAgent: string`, `onAgentChange: (id: string) => void`, `disabled: boolean`
- Dropdown listing registered agents (default, default-neo4j, web-search, conversational-memory, etc.)
- Clearing the session on agent switch

#### 6. SupportPanel.tsx
Tabbed right panel. **Observability is the default tab.** Uses `lazyMount` + `unmountOnExit` so inactive tabs don't hold Cytoscape instances in memory.

| Tab | Content |
|-----|---------|
| Neo4j | Graph visualization for Neo4j query results (accumulated, live sync) |
| Memory | Graph visualization for Memory MCP entities |
| All (Turn Explorer) | Turn-based graph explorer — select specific turns, color-coded |
| **Observability** *(default)* | Event timeline + LLM call detail |
| Data | Data Stash — tool result icons, hide/archive controls |
| Tools | MCP tool configuration via `ToolsPanel` |

**Conversation Sync toggle:** The Neo4j and Memory graph tabs have a ⏸/▶ "Sync" button (cyan when live, amber when paused). Implemented in `GraphTabContent` via a `syncEnabled` signal. When paused, the current element list is snapshotted into `frozenElements` and passed to `GraphVisualization` instead of live `props.elements`. Resuming restores the live feed.

**Touched-node highlight (Neo4j tab only):** When an agent runs a Neo4j query, the `enrichNeo4jResult` hook (`onToolResult` on `simpleLoop`) attaches a 1-hop neighborhood plus a `_touched` list to the tool result. The extractor tags nodes whose name is in that list with `data.touched = true`, and the Neo4j tab passes a static `TOUCHED_NODE_STYLES` block (`node[touched]` selector → magenta fill/border + glow) as `extraStyles` to `GraphVisualization`. The result: nodes the agent's query *actually targeted* render in magenta, while neighborhood-context nodes render in the default cyan. The Memory tab does not receive this stylesheet.

**Touched-flag refresh across turns** (`ui/src/lib/graph-merge.ts`): `index.tsx` accumulates elements via `mergeGraphElements(prev, fresh)` rather than ad-hoc dedup. When a fresh batch carries any element with `touched: true`, the merger first strips the flag from all prior elements, then re-applies it to elements in the new batch — so the magenta highlight tracks the most recent enriched query and doesn't linger on nodes from earlier topics. When the fresh batch carries no `touched` flags (e.g., a non-enriched tool, or a count-only query), prior `touched` flags are preserved.

**All Tab — Turn Explorer (AllGraphTab.tsx):**
The All tab does not use the accumulated `graphElements` signal. Instead, it derives graph elements on-demand from `contextEvents`:

1. `splitIntoTurns()` (from `turn-utils.ts`) splits the event stream at `user_message` boundaries
2. User opens the FloatingPanel ("Turns" button) to see turn columns side-by-side
3. Each column shows turn number, user message preview, and graph-producing tool results
4. Clicking a turn header toggles its selection; "All"/"None" buttons for bulk selection
5. `extractMultiTurnGraphElements()` extracts and merges elements from selected turns, tagging each with `data.turn = N`
6. Cytoscape renders elements with per-turn colors via `extraStyles` prop (attribute selectors: `node[turn=N]`)
7. A color legend overlay in the bottom-right corner shows the turn-color mapping

#### 7. GraphVisualization.tsx
Cytoscape.js graph component with dark futuristic theme.

**Rendering lifecycle:** With `unmountOnExit` on `Tabs.Root`, Cytoscape instances are fully created/destroyed when switching tabs. A `ResizeObserver` on `containerRef` drives a `visible()` signal to defer layout until the container has non-zero dimensions.

**Base styles** are extracted to a module-level `BASE_STYLES` constant. The `extraStyles` prop appends additional stylesheets (e.g. per-turn color rules) — a reactive `createEffect` re-applies `cy.style([...BASE_STYLES, ...extraStyles])` when they change.

**Features:**
- Incremental graph updates (additive, preserves positions)
- Collapsible Display Controls panel: node size, edge width, font size, edge labels toggle
- Node properties panel on click (inline `data` + `properties` merged)
- Inline property editing (pencil icon → textarea → Cypher persist via `onCypherWrite`)
- Relation creation mode (purple banner, click source then target)
- Node creation form ("+ Node" toolbar button — Name, Label, Description)
- `highlightedIds` prop adds `.highlighted` CSS class to matching elements
- `extraStyles` prop for dynamic Cytoscape stylesheet injection (used by AllGraphTab for turn colors)

**Props:**
```typescript
{
  elements: ElementDefinition[]
  highlightedIds?: string[]         // IDs to visually highlight (from chat entity hover/toggle)
  onNodeClick?: (id, data) => void
  onEdgeClick?: (id, data) => void
  onCypherWrite?: (cypher, params?) => Promise<void>  // For write operations
  extraStyles?: StylesheetJsonBlock[] // Additional Cytoscape styles (e.g. per-turn colors)
}
```

#### 8. ObservabilityPanel.tsx
Displays the full agent event timeline:
- Events are merged into `TimelineItem[]` via `buildTimelineItems()`: `tool_call` + `tool_result` pairs sharing the same `callId` appear as a single merged row
- Click any row → detail overlay with args / result / LLM call data
- **Save button** (floating, bottom-right): calls `showSaveFilePicker()` to save the full `UnifiedContext` as a named JSON file; falls back to `<a download>` on browsers without File System Access API
- Requires `context?: UnifiedContext` prop threaded down from `index.tsx` → `SupportPanel` → `ObservabilityPanel`

### Theme System

**File:** `ui/src/components/ark-ui/ThemeSwitcher.tsx`

```tsx
// Toggle between light/dark modes
// Persists to localStorage
// Updates document.documentElement.classList
```

**Custom Color Palette:** (defined in `uno.config.ts`)

```typescript
{
  cyber: {     // Purple/indigo brand colors
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    // ... full scale
  },
  neon: {      // Accent colors for highlights
    cyan: '#00ffff',
    magenta: '#ff00ff',
    purple: '#9d00ff',
    // ... more neon colors
  },
  dark: {      // Semantic dark theme tokens
    bg: {
      primary: '#0a0a0f',      // Darkest background
      secondary: '#12121a',    // Main panels
      tertiary: '#1a1a24',     // Cards/inputs
      hover: '#22222f',        // Interactive states
    },
    border: {
      primary: '#2a2a3a',      // Main borders
      secondary: '#3a3a4a',    // Secondary borders
      accent: '#4a4a5a',       // Highlighted borders
    },
    text: {
      primary: '#e4e4e7',      // Main text
      secondary: '#a1a1aa',    // Secondary text
      tertiary: '#71717a',     // Tertiary/muted text
    }
  }
}
```

**UnoCSS Shortcuts:**
- `glass-panel` - Semi-transparent panel with backdrop blur
- `neon-border` - Cyan border with glow effect
- `cyber-button` - Cyber-themed button with glow on hover

### Component Data Flow

```
index.tsx (top-level state)
    ├─ graphElements: Signal<GraphElement[]>     ← accumulated via mergeGraphElements (dedup + touched-flag refresh)
    ├─ contextEvents: Signal<ContextEvent[]>     ← accumulated per turn
    ├─ unifiedContext: Signal<UnifiedContext?>   ← latest full session context
    ├─ highlightedIds: Signal<string[]>          ← newly added graph node IDs
    ├─ graphEntityNames: Memo<Map<string, string[]>>  ← name → element IDs (for chat linking)
    │
    ├─> ChatInterface
    │       ├─ messages: Signal<Message[]>
    │       ├─ isProcessing: Signal<boolean>
    │       ├─ selectedAgent: Signal<string>
    │       │   Props: graphEntityNames, onHighlightEntities
    │       │
    │       ├─> AgentSelector (selectedAgent, onAgentChange, disabled)
    │       ├─> ChatMessages (messages, graphEntityNames, onHighlightEntities, onApproveWrite, onRejectWrite)
    │       │       └─ annotateEntities() — wraps entity names in interactive spans post-render
    │       ├─> ChatInput (onSend, disabled)
    │       └─> ChatSidebar (collapsed, onToggle)
    │
    └─> SupportPanel (lazyMount + unmountOnExit)
            │   Props: graphElements, contextEvents, highlightedIds, onCypherWrite
            ├─> GraphTabContent (Neo4j/Memory tabs)
            │       └─> GraphVisualization (elements, highlightedIds, onCypherWrite)
            │               └─ Inline edit / relation create / node create → onCypherWrite
            ├─> AllGraphTabWrapper (All tab — turn-based explorer)
            │       └─> AllGraphTab
            │               ├─ splitIntoTurns(contextEvents) → TurnData[]
            │               ├─ FloatingPanel with TurnColumn[] (horizontal layout)
            │               ├─ extractMultiTurnGraphElements() → tagged elements
            │               ├─> GraphVisualization (elements, extraStyles=turnStyles)
            │               └─ Turn color legend overlay
            ├─> DataStashPanel (events, onStashAction)
            ├─> SettingsPanel (FloatingPanel in ChatSidebar footer)
            │       └─ SliderSetting / NumberSetting components
            │       └─ getSettings() / updateSetting() from settings-store.ts
            ├─> ObservabilityPanel (events, context, onClear)
            │       ├─ buildTimelineItems() — merges tool pairs by callId
            │       └─ Save button → showSaveFilePicker() / <a download>
            └─> ToolsPanel
```

### Message Type
```typescript
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolCall?: {                          // Present when status === 'paused' (approval gate)
    type: string
    status: 'pending' | 'executed' | 'error'
    tool: string
    explanation?: string
    isReadOnly: boolean
    error?: string
  }
}
```

---

## 6. Conversation Persistence

Conversations are persisted to Postgres so they survive process restarts and list per-user in the sidebar. The store is a single `conversations(id, user_id, agent_id, title, context jsonb, created_at, updated_at)` table; the JSONB blob is the full `serializeContext()` output (no normalization). Schema is bootstrapped idempotently on first DB hit — bring-up is just `docker compose up -d`.

### Layers

| Layer | File | Role |
|-------|------|------|
| Pool | `lib/db/client.server.ts` | Lazy `pg.Pool` singleton, runs `CREATE TABLE IF NOT EXISTS` once per process |
| Repo | `lib/db/conversations.server.ts` | Typed CRUD: `loadConversation`, `saveConversation`, `listConversations`, `deleteConversation`, `deriveTitle` |
| Session | `lib/harness-client/session.server.ts` | In-process pattern cache (non-serializable BAML clients) + Postgres-backed serialized context, scoped by `userId` |
| Actions | `lib/harness-client/actions.server.ts` | `listConversations()`, `loadConversation()` server actions for the sidebar; auth-gated |
| Sidebar | `components/ark-ui/ChatSidebar.tsx` | Real thread list + "+ New Chat", selected-thread highlight |
| Page | `routes/index.tsx` | `selectedSessionId` signal; threads resource refetched after each turn |
| Hydration | `components/ark-ui/ChatInterface.tsx` | `createEffect` on `props.sessionId` replays events into graph + observability |

### Sticky titles

The first 60 chars of the first `user_message` becomes the conversation title. Once set, it never changes via `saveConversation()` — `COALESCE(conversations.title, EXCLUDED.title)` on update. (A dedicated rename action can override this when shipped.)

### Auth

Every public action and the `/api/events` / `/api/stash` routes authenticate via Stack Auth and scope session ops by `user.id`. When `VITE_DEV_BYPASS_AUTH=true`, the user id falls back to `dev-bypass-user`.

---

## 6a. Per-Session Progress & Submit Guard (#47)

The live progress bar and "Waiting for `<tool>`…" composer guard are scoped to a conversation, not to the `ChatInterface` instance. Switching threads while a chain is running leaves the streamed loop running on the server — progress keeps accumulating in the originating session's controller, and the bar restores on return.

### State location

`routes/index.tsx` owns two parallel per-session registries:

| Registry | Shape | Purpose |
|----------|-------|---------|
| `progressBySession` | `Map<sessionId, ChainProgressController>` | One progress controller per session. Lazily created on first read. |
| `runStates` signal | `Record<sessionId, SessionRunState>` | Reactive `{ isProcessing, runningTool }` per session — drives the composer guard banner and the bar's `visible` flag. |
| `abortControllers` | `Map<sessionId, AbortController>` | One in-flight SSE stream per session. Aborted only on page unload (not on chat switch). |

`ChatInterface` receives `getProgress`, `getRunState`, `updateRunState`, `registerAbortController`, `unregisterAbortController` as props. Inside `handleSendMessage` the active `props.sessionId` is captured as `runSessionId` at submit time — all subsequent state mutations are keyed on that captured id, not the live prop, so events that arrive after a chat switch don't pollute the wrong view.

### Event routing

- **Progress is always routed** into `getProgress(runSessionId)` regardless of which chat the user is viewing.
- **Tool name** is extracted from `controller_action.action.tool_name` and pushed via `updateRunState(runSessionId, { runningTool })`. When `is_final` is true the field clears.
- **Graph, events, messages, context** are dropped when `runSessionId !== props.sessionId` — the active view owns those signals, and the persisted row will surface anything missed on the next hydration.

### SSE envelope

`api/events.ts` now spreads `sessionId` into every emitted JSON object (the `event: done` payload too). It's not part of the typed `ContextEvent` shape — it's an envelope-only field consumed by the client.

### Submit guard

`ChatInput` now keeps the textarea editable while `disabled` is true. The Enter handler still no-ops, but the user's draft survives. A `blockedMessage` prop renders an inline banner above the input; it's set by `ChatInterface` to `` `Waiting for \`<tool>\` to complete. Try later.` `` whenever the active session has both `isProcessing` and a `runningTool`.

### Lifecycle

| Event | Behavior |
|-------|----------|
| Submit on a non-running chat | `getProgress(sid).reset()`; `updateRunState(sid, { isProcessing: true })`; SSE opens; per-session `AbortController` registered. |
| Switch chats mid-stream | Nothing aborts. `selectedSessionId` swaps; `ChatInterface`'s reactive memos pick up the new session's controller (idle → bar hides). |
| Switch back to the running chat | The original controller's snapshot signal is still live; the bar re-renders with the current `currentTurn` and `status`. |
| Stream completes | `progress.finish()`; `updateRunState(sid, { isProcessing: false, runningTool: null })`; `AbortController` unregistered. |
| Tab close / `beforeunload` | Route iterates `abortControllers.values()` and aborts each → no zombie fetches in DevTools. |

---

## 7. UnoCSS Limitations & Workarounds

### SVG Elements
**UnoCSS attributify does NOT work on `<svg>` elements.**

Use standard SVG attributes:
```tsx
// ❌ WRONG - Causes TypeScript errors
<svg w="16" h="16" m="auto">

// ✓ CORRECT
<svg width="16" height="16" style="margin: 0 auto;">
```

**Attributes to convert:**
- `w="..."` → `width="..."`
- `h="..."` → `height="..."`
- `m="..."` → `style="margin: ..."`
- `text="color"` → `style="color: ..."`
- `transform="..."` → Use inline style with dynamic values

**Event handlers:** Wrap reactive values in functions for SolidJS
```tsx
// ❌ WRONG
onClick={props.onToggle}

// ✓ CORRECT
onClick={() => props.onToggle()}
```

---

## Quick Commands

```bash
pnpm dev          # Start dev server (port 3444)
pnpm dev:exposed  # Bind to 0.0.0.0 (needed for Docker / Playwright MCP)
pnpm build        # Production build
pnpm eslint       # Run linter
pnpm test:run     # Run vitest unit tests
```

---

## File Locations Cheatsheet

```
ui/
├── eslint.config.ts              # ESLint rules
├── uno.config.ts                 # UnoCSS config + theme
├── baml_src/                     # BAML function definitions
│   ├── clients.baml              # LLM client config
│   ├── routing.baml              # Message routing
│   ├── neo4j.baml                # Neo4j planning
│   ├── code_mode.baml            # Code mode composition
│   └── response.baml             # Response generation
├── src/
│   ├── shims.d.ts                # TypeScript augmentation
│   ├── routes/
│   │   └── index.tsx             # Main page with Splitter layout
│   ├── components/
│   │   ├── AuthProvider.tsx      # Auth context provider
│   │   ├── Nav.tsx               # Main navigation with theme switcher
│   │   └── ark-ui/
│   │       ├── UserMenu.tsx           # Avatar dropdown menu
│   │       ├── ThemeSwitcher.tsx      # Dark/light theme toggle
│   │       ├── ChatInterface.tsx      # Main chat container
│   │       ├── ChatSidebar.tsx        # Thread history sidebar
│   │       ├── ChatMessages.tsx       # Message display area
│   │       ├── ChatInput.tsx          # Autoresize textarea
│   │       ├── GraphVisualization.tsx # Cytoscape graph display (+ extraStyles prop)
│   │       ├── SupportPanel.tsx       # Tabbed right panel (lazyMount + unmountOnExit)
│   │       ├── AllGraphTab.tsx        # Turn-based graph explorer (FloatingPanel + color-coded)
│   │       ├── SettingsPanel.tsx      # Harness settings FloatingPanel (sliders, number inputs)
│   │       ├── ObservabilityPanel.tsx # Event timeline + tool-pair merging + Save button
│   │       ├── EventDetailOverlay.tsx # Event detail modal
│   │       ├── ToolsPanel.tsx         # MCP tool configuration UI
│   │       ├── ToolCallDisplay.tsx    # Tool call status display (approval gate)
│   │       ├── AgentSelector.tsx      # Agent selection dropdown
│   │       └── EnvVarManager.tsx      # Environment variable config
│   └── lib/
│       ├── auth/                  # Authentication
│       │   ├── client.ts          # StackClientApp
│       │   ├── server.ts          # Server auth helpers (getAuthenticatedUser, dev-bypass)
│       │   └── allowList.ts       # Email access control
│       ├── db/                    # Postgres-backed persistence
│       │   ├── client.server.ts        # Lazy pg.Pool singleton + idempotent schema bootstrap
│       │   └── conversations.server.ts # Conversations repo (load/save/list/delete + deriveTitle)
│       ├── harness-patterns/      # Composable agent pattern framework
│       │   ├── index.ts           # Public exports
│       │   ├── types.ts           # UnifiedContext, PatternScope, ContextEvent, callId, etc.
│       │   ├── context.server.ts  # createContext(), createEvent(), generateId()
│       │   ├── tools.server.ts    # Tools() — MCP tool grouping by namespace
│       │   ├── router.server.ts   # router() pattern
│       │   ├── harness.server.ts  # harness(), resumeHarness(), continueSession()
│       │   ├── routing.server.ts  # BAML router integration
│       │   ├── state.server.ts    # Session state (serialize / deserialize)
│       │   ├── mcp-client.server.ts # callTool(), listTools()
│       │   ├── assert.server.ts   # Server-only import guards
│       │   ├── token-budget.server.ts # trimToFit(), getContextWindow(), estimateTokens()
│       │   ├── summarize.server.ts    # scheduleSummarization() — background result summarization
│       │   └── patterns/
│       │       ├── simpleLoop.server.ts   # ReAct loop + callId on tool events
│       │       ├── actorCritic.server.ts  # Generate-evaluate + callId
│       │       ├── withApproval.server.ts # Approval gate + pattern_enter/exit
│       │       ├── parallel.server.ts     # Concurrent branches + pattern_enter/exit
│       │       ├── guardrail.server.ts    # Rail validation + pattern_enter/exit
│       │       ├── hook.server.ts         # Lifecycle hook + pattern_enter/exit
│       │       ├── synthesizer.server.ts  # Final response synthesis
│       │       ├── chain.server.ts        # Sequential composition
│       │       └── event-view.server.ts   # EventViewImpl (fluent query API)
│       ├── settings.ts             # HarnessSettings type, defaults, MODEL_CONTEXT_WINDOWS
│       ├── settings-store.ts      # Client-side reactive store (localStorage persistence)
│       ├── settings-context.server.ts # Request-scoped settings via AsyncLocalStorage
│       ├── turn-utils.ts           # splitIntoTurns(), extractTurnGraphElements()
│       ├── turn-colors.ts         # TURN_COLORS palette, getTurnColor()
│       ├── neo4j/
│       │   ├── queries.ts         # runManualCypher(), getNodeProperties()
│       │   └── write-action.ts    # executeCypherWrite() — parameterized Cypher writes from graph UI
│       └── harness-client/        # Pre-built agent server actions
│           ├── actions.server.ts  # processMessage(), processMessageStreaming(), listConversations(), loadConversation()
│           ├── session.server.ts  # In-process pattern cache + Postgres-backed serialized context (per-user)
│           ├── registry.server.ts # Agent registry (10 examples)
│           ├── graph-extractor.ts # ContextEvent → GraphElement[]
│           ├── neo4j-enricher.server.ts # onToolResult recipe (1-hop neighborhood + touched tags)
│           ├── types.ts           # GraphElement, HarnessData, etc.
│           └── examples/          # 10 pre-built agent configurations
```

---

## MCP Tools Available

### Context7
- `resolve-library-id` - Search for library documentation
- `get-library-docs` - Fetch up-to-date docs for a library

**Example:**
```typescript
// 1. Find library ID
const results = await resolveLibraryId({ libraryName: "solidjs" })
// → Returns: /solidjs/solid, /solidjs/solid-start, etc.

// 2. Get documentation
const docs = await getLibraryDocs({
  context7CompatibleLibraryID: "/solidjs/solid",
  topic: "signals and reactivity",
  tokens: 3000
})
```

### Ark UI
- `list_components` - List all available Ark UI components
- `get_component_props` - Get props for a specific component
- `list_examples` - List examples for a component
- `get_example` - Get specific example code
- `styling_guide` - Get data attributes for styling

**Frameworks:** ~react, vue, svelte,~ *solid*
