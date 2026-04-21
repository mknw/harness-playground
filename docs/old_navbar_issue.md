# Current Issue: Page Renders Only Navbar

**Status:** Unresolved
**Date:** 2026-02-03
**Component:** `ui/src/routes/index.tsx` and import chain

## Problem Description

When loading the main page at `http://localhost:3444/`, only the navbar renders. The main content (ChatInterface, SupportPanel, Splitter) does not appear. No JavaScript errors are shown in the browser console.

## Symptoms

1. Navbar (`<Nav />`) renders correctly
2. Content below navbar is blank
3. No visible JavaScript errors in console
4. Vite HMR connects successfully
5. Only warning: "A resource is blocked by OpaqueResponseBlocking" (Google profile image - CORS issue, unrelated)

## Root Cause Analysis

The issue is related to the import chain from `harness-client` causing silent client-side failures during module loading.

### Import Chain

```
routes/index.tsx
  └─ ChatInterface.tsx
       └─ ~/lib/harness-client
            ├─ actions.server.ts (has "use server")
            ├─ registry.server.ts (has "use server")
            │    └─ imports 10 example agents at module level
            │         └─ Each imports from harness-patterns
            ├─ graph-extractor.ts (client-safe)
            └─ types.ts (client-safe)
```

### The Problem

The `harness-client/index.ts` barrel file re-exports from multiple sources:

```typescript
// Server Actions (safe - transformed to RPC)
export { processMessage, ... } from './actions.server'

// THIS IS THE PROBLEM:
export { getAgentMetadata, type AgentConfig } from './registry.server'

// Client-safe
export { extractGraphFromResult } from './graph-extractor'
```

Even though `registry.server.ts` has `"use server"` directive, when the barrel is imported, it triggers parsing of `registry.server.ts` which has module-level imports:

```typescript
// registry.server.ts
"use server";

// These imports execute at parse time
import { defaultAgent } from "./examples/default.server";
import { docAssistantAgent } from "./examples/doc-assistant.server";
// ... 8 more imports
```

This causes a cascade of module loading that fails silently on the client.

## Attempted Fixes

### 1. Separated registry import (Partial fix - Not working)

```typescript
// harness-client/index.ts
// Removed: export { getAgentMetadata } from './registry.server'
// Added comment: Import directly from registry.server.ts

// AgentSelector.tsx
import { getAgentMetadata } from '~/lib/harness-client/registry.server'
```

**Result:** Still not rendering. The change was committed but issue persists.

### 2. Added ErrorBoundary and Suspense fallback (Diagnostic)

```typescript
// app.tsx
<ErrorBoundary fallback={(err) => <div>Error: {err.message}</div>}>
  <Suspense fallback={<div>Loading...</div>}>
    {props.children}
  </Suspense>
</ErrorBoundary>
```

**Result:** Neither fallback renders, suggesting error occurs before React rendering.

### 3. Minimal test component (Diagnostic)

```typescript
// routes/index.tsx
export default function Home() {
  return <h1 style={{ color: 'lime' }}>TEST</h1>
}
```

**Result:** This renders successfully! The issue is in the imports.

### 4. Isolated Splitter test (Diagnostic)

```typescript
import { Splitter } from '@ark-ui/solid/splitter'
// ... minimal splitter usage
```

**Result:** Awaiting confirmation.

## Remaining Investigation

1. **Test each import individually:**
   - `import { Splitter } from '@ark-ui/solid/splitter'`
   - `import { ChatInterface } from '~/components/ark-ui/ChatInterface'`
   - `import { SupportPanel } from '~/components/ark-ui/SupportPanel'`

2. **Check ChatInterface imports:**
   - It imports from `~/lib/harness-client` which may still trigger server module loading
   - It imports `AgentSelector` which imports from `registry.server.ts`

3. **Verify server action transformation:**
   - SolidStart should transform `"use server"` exports to RPC calls
   - The transformation may not be working correctly for re-exports

## Potential Solutions

### Solution A: Complete client/server separation

Create separate entry points:

```
harness-client/
  index.ts          # Client-safe only (types, graph-extractor)
  server.ts         # Server-only (actions, registry)
```

### Solution B: Lazy load server modules

Use dynamic imports in components:

```typescript
const { getAgentMetadata } = await import('~/lib/harness-client/registry.server')
```

### Solution C: Move AgentSelector fetch to server action

Create a dedicated server action for fetching agent metadata:

```typescript
// actions.server.ts
"use server";
export async function getAgentList() {
  return getAgentMetadata()
}
```

Then import only from actions.server.ts which properly handles the "use server" directive.

## Files Involved

- `ui/src/routes/index.tsx` - Main page
- `ui/src/components/ark-ui/ChatInterface.tsx` - Chat component
- `ui/src/components/ark-ui/AgentSelector.tsx` - Dropdown that imports registry
- `ui/src/lib/harness-client/index.ts` - Barrel file
- `ui/src/lib/harness-client/registry.server.ts` - Agent registry with heavy imports
- `ui/src/lib/harness-client/examples/*.server.ts` - 10 example agent files

## Environment

- SolidStart with Vinxi
- Vite dev server on port 3444
- TypeScript with bundler moduleResolution
- UnoCSS with attributify mode
- Ark UI for components

## Related Commits

- `00ae9ec` - fix(imports): separate server-only registry import from client barrel
- `339719e` - fix(types): resolve TypeScript and ESLint errors
