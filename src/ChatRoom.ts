import { DurableObject } from "cloudflare:workers";

// Define the shape of our per-connection state
interface SessionState {
  username: string; // The authenticated user (e.g. "User1" or "User2")
  joinedAt: number;
}

interface CloudflareBindings {
  JWT_SECRET: string;
  TOTP_SECRET_1: string;
  TOTP_SECRET_2: string;
  rooms: DurableObjectNamespace<ChatRoom>;
}

export class ChatRoom extends DurableObject {
  // Store active sessions in memory
  // In Hibernation API, we don't need a Map<WebSocket, SessionState> because
  // state is attached directly to the WebSocket object via serializeAttachment/deserializeAttachment.
  // However, for broadcasting to *other* sockets, we need to get *all* sockets.
  // this.ctx.getWebSockets() gives us all active sockets.

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    // Initialize storage if needed (e.g. for message history)
    // this.ctx.blockConcurrencyWhile(async () => { ... }) if needed
  }

  async fetch(request: Request): Promise<Response> {
    // The Worker will upgrade the request to a WebSocket and pass it here.
    // We expect an Upgrade header.
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    // Get the username passed from the Worker (e.g. via headers or URL params)
    const url = new URL(request.url);
    const username = url.searchParams.get("username") || "Anonymous";

    // Create the WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket (Hibernation API)
    this.ctx.acceptWebSocket(server);

    // Initial state for this connection
    const state: SessionState = {
      username,
      joinedAt: Date.now()
    };

    // Serialize this state so it survives hibernation
    server.serializeAttachment(state);

    // Send the last few messages to the new user from storage
    const messages = await this.ctx.storage.list({ limit: 50, reverse: true });
    // messages is a Map. We need to send them in chronological order.
    // The keys are timestamps (or sortable IDs).
    const history = Array.from(messages.values()).reverse().map(str => JSON.parse(str as string));
    
    server.send(JSON.stringify({ type: "history", messages: history }));

    // Broadcast that someone joined
    this.broadcast({ type: "system", text: `${username} joined the room.` });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Restore state
    const state = ws.deserializeAttachment() as SessionState;
    
    try {
      const data = JSON.parse(message as string);
      
      if (data.text) {
        // Create full message object
        const fullMessage = {
          id: crypto.randomUUID(),
          user: state.username,
          text: data.text,
          timestamp: Date.now()
        };

        // Broadcast to everyone
        this.broadcast({ type: "message", ...fullMessage });

        // Save to storage (fire and forget promise, or await if critical)
        // Use current timestamp as key for simple sorting
        // To avoid collisions/overwrites, use timestamp + random suffix or ULID
        // For simple chat, Date.now() is mostly fine but risky.
        // Better: customized sortable key.
        const key = `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        await this.ctx.storage.put(key, JSON.stringify(fullMessage));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", error: "Invalid message format" }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const state = ws.deserializeAttachment() as SessionState;
    // Broadcast leave
    this.broadcast({ type: "system", text: `${state.username} left the room.` });
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    // Handle error (maybe close?)
    // console.error("WebSocket error:", error);
  }

  private broadcast(msg: any) {
    const msgStr = JSON.stringify(msg);
    // Get all connected WebSockets from the state
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msgStr);
      } catch (err) {
        // If send fails, the socket might be dead, but getWebSockets() usually returns active ones.
        // Redundant close?
      }
    }
  }
}
