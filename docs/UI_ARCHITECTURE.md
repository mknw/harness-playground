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

## Quick Commands

```bash
pnpm dev        # Start dev server
pnpm build      # Production build
pnpm eslint     # Run linter
```

---

## File Locations Cheatsheet

```
ui/
├── eslint.config.ts              # ESLint rules
├── uno.config.ts                 # UnoCSS config
├── src/
│   ├── shims.d.ts                # TypeScript augmentation
│   ├── components/
│   │   ├── AuthProvider.tsx      # Auth context provider
│   │   ├── Nav.tsx               # Main navigation
│   │   └── ark-ui/
│   │       └── UserMenu.tsx      # Avatar dropdown
│   └── lib/auth/
│       ├── client.ts             # StackClientApp
│       ├── server.ts             # Server auth helpers
│       └── allowList.ts          # Email access control
```
