# Private Chat Room

A secure, private chat room for two people, built with Cloudflare Workers, Durable Objects, and Hono.

## Features

- **Secure Authentication**: Uses TOTP (Time-Based One-Time Password) to verify users. No passwords, just a code from your authenticator app.
- **WebSocket Hibernation**: Uses Cloudflare's Durable Objects Hibernation API for extreme cost efficiency (DO sleeps when idle, waking only for messages).
- **Single Room**: Hardcoded to a single "MainRoom" instance.
- **Hono Framework**: Uses Hono for clean routing and middleware.

## Setup

1.  **Install Dependencies**:
    ```bash
    bun install
    ```

2.  **Configure Secrets**:
    You need to set up your TOTP secrets.
    - Generate two base32 secrets (e.g. using `qrencode` or an online generator).
    - Add them to `wrangler.jsonc` (for local dev) or use `wrangler secret put` (for production).
    
    **Local Development**:
    Edit `wrangler.jsonc`:
    ```jsonc
    "vars": {
      "TOTP_SECRET_1": "JBSWY3DPEHPK3PXP", // Example Secret 1
      "TOTP_SECRET_2": "JBSWY3DPEHPK3PXQ", // Example Secret 2
      "JWT_SECRET": "your-256-bit-secret"
    }
    ```

3.  **Run Locally**:
    ```bash
    bun run dev
    ```

4.  **Deploy**:
    ```bash
    bun run deploy
    ```

## Architecture

- **Worker (`src/index.ts`)**: entry point. Uses Hono.
  - `GET /`: Serves the HTML UI.
  - `POST /auth`: Verifies TOTP code, returns a signed JWT cookie.
  - `GET /ws`: Upgrades to WebSocket if cookie is valid, proxies to Durable Object.
  
- **Durable Object (`src/ChatRoom.ts`)**:
  - Manages WebSocket connections.
  - Broadcasts messages.
  - Persists history in storage.
  - Uses Hibernate API (`serializeAttachment`, `webSocketMessage`) to minimize costs.
