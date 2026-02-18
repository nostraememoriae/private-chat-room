# Cloudflare Vite Plugin Migration Journey

**Date:** February 18, 2026  
**Context:** Migrating a Svelte + Cloudflare Workers SPA with WebSocket support from a split manual setup to the unified Cloudflare Vite plugin architecture.

## Problem: The Original Setup

Our project had a **manual, split architecture**:

```
frontend/
  ├── vite.config.ts          # Separate Svelte build config
  ├── index.html
  └── src/
      ├── App.svelte
      └── main.ts

src/
  ├── index.ts                # Hono worker (main entry)
  ├── ChatRoom.ts             # Durable Object
  └── totp.ts

wrangler.jsonc               # Worker config (no assets setup)
package.json
  scripts:
    dev:frontend: vite dev --config frontend/vite.config.ts
    dev: wrangler dev
    build: vite build --config frontend/vite.config.ts
```

### Pain Points

1. **Two Dev Processes** - Had to run `dev:frontend` and `dev` separately, losing state on edits
2. **Manual Proxying** - Frontend dev server proxied `/auth` and `/ws` calls to `localhost:8787`
3. **Separate Builds** - Frontend built to `public/`, Worker built separately
4. **No Unified Workflow** - Build script only built frontend, asset serving was implicit
5. **Not Following Official Pattern** - Cloudflare provides a specific tutorial pattern we weren't using

## Why Migrate?

The **Cloudflare Vite plugin** provides:
- ✅ Single unified dev experience (`wrangler dev` handles both frontend + worker)
- ✅ Unified build process (`vite build` handles both environments)
- ✅ Automatic static asset serving via `assets` binding
- ✅ Better type safety and integration
- ✅ Closer alignment with Cloudflare's official patterns

## The Migration Process

### Step 1: Install the Plugin

```bash
bun add -D @cloudflare/vite-plugin
```

### Step 2: Create Root vite.config.ts

Create a unified Vite config at the project root:

```typescript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [svelte(), cloudflare()],
});
```

**Key insight:** The `cloudflare()` plugin automatically detects `wrangler.jsonc` and coordinates both environments.

### Step 3: Update wrangler.jsonc

Add asset configuration for SPA routing:

```jsonc
{
  "name": "private-chat-room",
  "main": "src/index.ts",
  "compatibility_date": "2026-02-18",
  "assets": {
    "not_found_handling": "single-page-application"
  },
  // ... rest of config
}
```

**What this does:**
- `not_found_handling: "single-page-application"` → All 404s serve `index.html` (SPA pattern)
- When combined with the Vite plugin, this auto-manages the assets binding

### Step 4: Simplify package.json Scripts

**Before:**
```json
"scripts": {
  "build": "vite build --config frontend/vite.config.ts",
  "dev:frontend": "vite dev --config frontend/vite.config.ts",
  "dev": "wrangler dev",
}
```

**After:**
```json
"scripts": {
  "build": "vite build",
  "dev": "wrangler dev",
}
```

### Step 5: Create svelte.config.js

Add Svelte config at project root (prevents "no config found" warnings):

```javascript
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

### Step 6: Remove Obsolete Configs

- Removed `rules` from `wrangler.jsonc` (not applicable with Vite)
- Removed `frontend/vite.config.ts` (root config handles everything)

---

## Critical Problem: Entry Point Resolution 🚨

After initial migration, we had a crucial question:

**"Who handles requests to `/`?"**

The Svelte app is a SPA that needs to serve `index.html` at `/`. But with Hono handling ALL requests in `src/index.ts`, would `/` ever reach the static assets?

### The Journey

#### Issue 1: Entry Point Confusion

Our `src/index.ts` (Hono worker) handles:
```typescript
app.post('/auth', ...)
app.get('/ws', ...)
// Everything else returns 404
```

If Hono returned 404 for `/`, then... nothing served the Svelte app.

#### Issue 2: Build Output Mismatch

After first migration, `vite build` produced:
```
dist/
  ├── client/
  │   ├── index.3Whlvqkx.css
  │   ├── index.B0EL7XVb.js
  │   └── __cloudflare_fallback_entry__  ← empty placeholder
  └── private_chat_room/
      ├── .vite/manifest.json
      ├── index.js (the Hono worker)
      └── wrangler.json
```

The Svelte app JS/CSS were in `dist/client/` but **no `index.html`**. Only a `__cloudflare_fallback_entry__` placeholder.

**Root cause:** `frontend/index.html` existed in `frontend/`, but the root vite.config.ts didn't know where to find it.

#### Issue 3: index.html Location

With `root: 'frontend'` override attempt:
```typescript
export default defineConfig({
  root: 'frontend',  // Look for index.html in frontend/
  plugins: [svelte(), cloudflare()],
})
```

This caused the build environments to misalign:
- Worker built to `dist/private_chat_room/` ❌
- Client built to `frontend/dist/` ❌
- Root `vite.config.ts` now had `root: 'frontend'`, breaking both

#### Issue 4: Rollup Output Path Preservation

Attempted using `environments.client.build.rollupOptions.input`:
```typescript
environments: {
  client: {
    build: {
      rollupOptions: {
        input: 'frontend/index.html',  // Non-root path
      },
    },
  },
}
```

Result: `dist/client/frontend/index.html` (Rollup preserves directory structure)

Cloudflare then tried to serve it at `/frontend/index.html` instead of `/index.html` ❌

---

## Solution: Move index.html to Project Root

The **official Cloudflare Vite plugin tutorial** keeps `index.html` at the project root.

```
index.html                    # ← Moved from frontend/
├── frontend/
│   └── src/
│       ├── App.svelte
│       ├── main.ts
│       └── ...
├── src/
│   ├── index.ts             # Hono worker
│   └── ...
├── vite.config.ts
└── wrangler.jsonc
```

**Why this works:**
1. Vite (with root at project root) finds `index.html` naturally
2. Rollup outputs to `dist/client/index.html` (at root)
3. Cloudflare's asset layer serves it at `/`
4. Updated script reference: `<script src="frontend/src/main.ts"></script>`

### The Architecture Now

```
┌─────────────────────────────────────────────┐
│       vite build (unified)                  │
└──────────────┬──────────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
        ▼             ▼
   ┌─────────┐   ┌──────────────┐
   │ Worker  │   │   Client     │
   │ Env     │   │   Env        │
   └────┬────┘   └────┬─────────┘
        │             │
        │             ▼
        │        dist/client/
        │        ├── index.html      ← Served at / (SPA)
        │        ├── assets/
        │        │   ├── *.js
        │        │   └── *.css
        │        └── wrangler.json
        │
        ▼
   dist/private_chat_room/
   ├── index.js              ← Hono worker code
   ├── wrangler.json         ← Output config
   └── .dev.vars
```

### Request Flow

```
Client makes request to /
     │
     ▼
Cloudflare Asset Layer
(not_found_handling: single-page-application)
     │
     ├─ Matches static asset in dist/client/? → Serve it
     │ (HTML, JS, CSS)
     │
     ├─ /api/* or /ws? → Run worker first
     │ (Hono routes)
     │
     └─ 404 on all others → Serve /index.html
     (SPA navigation)
```

---

## Key Learnings

### 1. Cloudflare's Asset Binding is Automatic

With the Vite plugin + `assets` config in wrangler.jsonc, you don't write explicit code. The plugin:
- Automatically serves `dist/client/**` as static assets
- Applies `not_found_handling` rules
- Makes assets available to workers via `env.ASSETS`

### 2. Entry Point Location Matters

For Vite with the Cloudflare plugin:
- `index.html` must be at the Vite root (project root in our case)
- The plugin uses Vite's environment detection to determine what to build
- If `index.html` isn't found, only the worker builds (no client environment)

### 3. Dev Experience is Unified with wrangler dev

```bash
bun run dev  # → wrangler dev
```

Now runs:
- Vite dev server (frontend hot reloading)
- Worker preview (Miniflare runtime)
- Both in one process through the Cloudflare plugin

No manual proxying needed. WebSocket works automatically.

### 4. Build Output is Deterministic

```bash
bun run build  # → vite build
```

Produces:
- `dist/client/` - Static assets + HTML + wrangler.json for asset manifest
- `dist/private_chat_room/` - Worker code + output wrangler.json

The output `wrangler.json` in `dist/private_chat_room/` is what gets deployed.

### 5. SPA Pattern with Cloudflare

For single-page apps on Workers:
```jsonc
"assets": {
  "not_found_handling": "single-page-application"
}
```

This tells Cloudflare:
- Serve HTML/CSS/JS normally
- On nav requests (Sec-Fetch-Mode: navigate) with no matching asset → serve `index.html`
- Worker code runs for non-navigation requests (API calls, specific routes)

---

## Before and After Checklist

| Aspect | Before | After |
|--------|--------|-------|
| **Config Files** | `frontend/vite.config.ts` + root `tsconfig.json` | Single root `vite.config.ts` + `svelte.config.js` |
| **Entry Point** | `frontend/index.html` | `index.html` (project root) |
| **Scripts** | `dev:frontend` + `dev` separate | Single `bun run dev` |
| **Build** | `vite build --config frontend/vite.config.ts` | `vite build` |
| **Dev Workflow** | Two terminals, manual proxy | One terminal, unified Vite + wrangler |
| **State Preservation** | Lost on edits (separate processes) | Preserved (single process) |
| **Asset Serving** | Manual (`public/` directory) | Automatic (Vite plugin manages) |
| **Deployment** | `wrangler deploy --minify` (after manual build) | `wrangler deploy` (uses dist/ output) |

---

## Deployment

After migration, deployment is simpler:

```bash
# Build (creates dist/ with both client and worker)
bun run build

# Deploy (uses the output wrangler.json)
bun run deploy
```

The output `dist/private_chat_room/wrangler.json` is the deployment manifest—it's pre-configured to reference `dist/client/` as the assets directory.

---

## References

- [Cloudflare Vite Plugin Tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)
- [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Vite Environments](https://vite.dev/guide/ssr#setting-up-the-dev-server)

---

## Final Thoughts

This migration taught us that **framework conventions exist for a reason**. The Cloudflare Vite plugin tutorial's pattern (root `index.html`, single config) isn't arbitrary—it's optimized for how Vite's environments and the asset binding work together.

When integrating multiple tools (Vite, Wrangler, Svelte), following the official guides first prevents going down rabbit holes. We learned this by trying workarounds (root overrides, environment configs) when the simplest solution was moving `index.html` back to the root.

The unified workflow is worth it: one dev process, better HMR, automatic asset coordination, and a clear deploy path.
