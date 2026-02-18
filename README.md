# Private Chat Room

A secure, private chat room for two people, built with Svelte, Cloudflare Workers, Durable Objects, and Hono.

## Features

- **Secure Authentication**: TOTP (Time-Based One-Time Password) verification via authenticator app.
- **Modern Frontend**: Svelte 5 reactive UI with real-time message updates.
- **WebSocket Hibernation**: Durable Objects Hibernation API for cost efficiency (sleeps when idle).
- **Single Room**: Hardcoded to a single "MainRoom" instance.

## Setup

1. **Install Dependencies**:
   ```bash
   bun install
   ```

2. **Configure Secrets**:
   Generate two base32 TOTP secrets and add to `.env` (local) or use `wrangler secret put` (production):
   - `TOTP_SECRET_1`
   - `TOTP_SECRET_2`
   - `JWT_SECRET`

3. **Run Locally**:
   ```bash
   bun run dev
   ```

4. **Deploy**:
   ```bash
   bun run deploy
   ```

## Architecture

- **Frontend (`frontend/src/`)**: Svelte 5 SPA
  - Built with Vite + `@sveltejs/vite-plugin-svelte`
  - Login screen with TOTP verification
  - Real-time chat interface with message history

- **Worker (`src/index.ts`)**: Cloudflare Worker entry point (Hono)
  - `POST /auth`: Verifies TOTP code, issues JWT cookie
  - `GET /ws`: WebSocket upgrade (auth required), proxies to Durable Object
  - Serves static assets from Vite build

- **Durable Object (`src/ChatRoom.ts`)**: Message coordination
  - Manages WebSocket connections between two users
  - Broadcasts messages and system events
  - Persists chat history in durable storage
  - Uses Hibernation API to minimize costs
