# Understanding Durable Objects Pricing: The "Stateful Server" Model

Durable Objects (DO) are fundamentally different from standard Cloudflare Workers (or Lambda functions). While a Worker is a stateless function that spins up and dies in milliseconds, a Durable Object is a **stateful micro-server** that can persist.

This unique architecture means its pricing is an "amalgamation" of compute, memory, and storage costs. This guide breaks it down simply.

## The Mental Model: DO = Tiny Dedicated Server

Think of a standard Worker as a function call: You pay for the execution time.
Think of a Durable Object as a **process**: It has memory (RAM), a CPU, and a hard disk (Storage). You pay for all three, but **only when it is actively working**.

### The Three Pillars of Billing

1.  **Requests**: The act of waking it up or talking to it.
2.  **Duration (Compute)**: The wall-clock time it spends "thinking" (CPU + RAM).
3.  **Storage (SQLite)**: The data it remembers on disk.

---

## 1. Compute & Requests (The Brain)

This is where the pricing model gets interesting, especially for chat apps.

### A. Requests (Waking Up)
Every time you call a Durable Object from a Worker (e.g., `room.fetch()`), it counts as **1 Request**.
*   **Quota**: 100,000 / day (Free Tier).

### Clarification: Does this share the Worker Quota? (The "Independent Buckets" Rule)
**NO.** Cloudflare's quotas are generally **independent services**. Using one does not eat into another.

| Service | Free Quota (Daily) | Is it Shared? |
| :--- | :--- | :--- |
| **Worker Requests** | 100,000 | ❌ No (Independent) |
| **Durable Object Requests** | 100,000 | ❌ No (Independent) |
| **KV Reads** | 100,000 | ❌ No (Independent) |
| **D1 Rows Read** | 5,000,000 | ❌ No (Independent) |
| **DO Storage Rows Read** | 5,000,000 | ❌ No (Independent) |
| **R2 Class A Ops** | 1,000,000 / month | ❌ No (Independent) |

**Source & Citation**:
> *"If you exceed any one of the free tier limits, further operations **of that type** will fail with an error."*
> — [Cloudflare Workers & Durable Object Pricing Docs](https://developers.cloudflare.com/workers/platform/pricing)

This confirms that limits are applied **per type of operation**. Consuming your Worker Request limit only affects Worker Requests, not your Durable Object capacity.

**Key Takeaway**: A complex app using Workers + DO + D1 + R2 + KV effectively has access to **millions** of free operations because each service draws from its own bucket. They do not pool together.

### B. Duration (Thinking Time)
You are billed for **Gigabyte-Seconds (GB-s)** of duration. This is calculated as:
`Time Active (seconds) × Memory Allocated (128MB fixed)`

*   **Quota**: 13,000 GB-seconds / day (Free Tier).
*   **The "Active" Rule**: You only pay when code is actually running.

### C. The WebSocket "Hack": Hibernation
Here is the magic for our chat app. Normally, keeping a WebSocket open to a server would cost you continuously because the server is "active".

Cloudflare uses **WebSocket Hibernation**:
1.  **Connect**: You pay for the handshake (milliseconds).
2.  **Idle**: The Durable Object goes to sleep (hibernates) but keeps the socket open in the network layer. **Cost: $0.00**.
3.  **Message**: When a message arrives, the DO wakes up, processes it (milliseconds), and goes back to sleep.

**The 20:1 Ratio**: For billing purposes, incoming WebSocket messages are extremely cheap.
*   **1 Incoming Message = 1/20th of a Request.**
*   **Outgoing Messages = FREE.**

---

## 2. Storage (The Memory)

Durable Objects now use **SQLite** as their storage backend. This confuses people because Cloudflare also has a product called D1 (serverless SQL).

### Is it D1?
*   **Technically:** Yes, it uses the same underlying tech.
*   **Billing-wise:** It uses the **same metric** (Rows Read/Written) but has a **separate quota**.
*   **Usage:** You don't write SQL. You use the JS API (`storage.put`, `storage.get`), and Cloudflare translates that into SQL operations for you.

### Costs
*   **Rows Read**: When you fetch data (e.g., loading chat history).
    *   *Quota*: 5,000,000 / day.
*   **Rows Written**: When you save data (e.g., storing a message).
    *   *Quota*: 100,000 / day.

---

## 3. The "Amalgamated" Bill: Chat App Example

Let's trace a user's journey to see how the bill adds up against the Free Tier.

| User Action | What Happens Technically | Billing Impact | Free Tier Status |
| :--- | :--- | :--- | :--- |
| **Login** | Worker validates TOTP | Worker Request (Standard) | ✅ Negligible |
| **Connect (`/ws`)** | Worker calls `room.fetch()` | **1 Request** (DO) + **~50 Rows Read** (History) | ✅ Tiny fraction of 100k limit |
| **Sit Idle** | WebSocket is Open | **$0.00** (Hibernation) | ✅ FREE |
| **Send "Hello"** | `webSocketMessage` runs | **0.05 Request** + **1 Row Write** + **~10ms Duration** | ✅ Tiny fraction of limits |
| **Receive Reply** | `broadcast()` runs | **~10ms Duration** (Outgoing msg is free) | ✅ Negligible |

## Visual Summary

```
[ Worker Request ]  -->  [ Durable Object Request ]
(Standard Billing)       (Wake Up / Handshake)

                         [ WebSocket Hibernation ]
                         (Sleeps... $0 Cost... Zzz)
                                     |
[ Incoming Msg ] ------> (Wakes Up for 10ms) ----> [ Storage Write ]
(1/20th Request)         (Duration Cost)           (1 Row Written)
```

## Troubleshooting "Why am I paying?"

If you ever see a bill (or hit a limit), it's usually because:
1.  **You forgot Hibernation**: You used standard `addEventListener` instead of the `state.acceptWebSocket()` API. Result: You pay for the *entire* connection duration.
2.  **Wrong Backend**: You used the legacy "KV" backend instead of "SQLite". (We fixed this in `wrangler.jsonc` by setting `new_sqlite_classes`).
3.  **Infinite Loops**: You created a loop that wakes the DO up constantly.

For your private chat usage, under the SQLite + Hibernation model, the cost is effectively **zero**.
