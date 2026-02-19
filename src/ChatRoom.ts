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

// Message types
const MSG_TYPE = {
  HISTORY: "history",
  MESSAGE: "message",
  SYSTEM: "system",
  ERROR: "error",
} as const;

// Storage / connection constants
const HISTORY_LIMIT = 50;
const DEFAULT_USERNAME = "Anonymous";

type ChatMessage = {
  id: number;
  type: string;
  user: string;
  text: string;
  timestamp: number;
};

type OutboundMessage =
  | { type: typeof MSG_TYPE.HISTORY; messages: ChatMessage[] }
  | ({ type: typeof MSG_TYPE.MESSAGE } & ChatMessage)
  | { type: typeof MSG_TYPE.SYSTEM; id?: number; text: string }
  | { type: typeof MSG_TYPE.ERROR; error: string };

export class ChatRoom extends DurableObject {
  // Store active sessions in memory
  // In Hibernation API, we don't need a Map<WebSocket, SessionState> because
  // state is attached directly to the WebSocket object via serializeAttachment/deserializeAttachment.
  // However, for broadcasting to *other* sockets, we need to get *all* sockets.
  // this.ctx.getWebSockets() gives us all active sockets.

  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Initialize storage
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY,
        type TEXT,
        user TEXT,
        text TEXT,
        timestamp INTEGER
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    // The Worker will upgrade the request to a WebSocket and pass it here.
    // We expect an Upgrade header.
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    // Get the username passed from the Worker (e.g. via headers or URL params)
    const url = new URL(request.url);
    const username = url.searchParams.get("username") || DEFAULT_USERNAME;

    // Create the WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket (Hibernation API)
    this.ctx.acceptWebSocket(server);

    // Initial state for this connection
    const state: SessionState = {
      username,
      joinedAt: Date.now(),
    };

    // Serialize this state so it survives hibernation
    server.serializeAttachment(state);

    // Send the last few messages to the new user from storage
    // Get the newest messages first, then reverse for chronological display
    const messages = this.sql
      .exec("SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?", HISTORY_LIMIT)
      .toArray() as ChatMessage[];
    
    // Reverse to send oldest first
    const history = messages.reverse();

    server.send(JSON.stringify({ type: MSG_TYPE.HISTORY, messages: history } satisfies OutboundMessage));

    // Broadcast that someone joined
    this.broadcastSystem(`${username} joined the room.`);

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
          type: MSG_TYPE.MESSAGE,
          user: state.username,
          text: data.text,
          timestamp: Date.now(),
        } satisfies Omit<ChatMessage, "id">;

        // Save to storage using SQL
        const insertedRow = this.insert(fullMessage);

        // Broadcast to everyone
        this.broadcast({id: insertedRow.id, ...fullMessage });
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: MSG_TYPE.ERROR, error: "Invalid message format" } satisfies OutboundMessage));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const state = ws.deserializeAttachment() as SessionState;
    // Broadcast leave
    this.broadcastSystem(`${state.username} left the room.`);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    // Handle error (maybe close?)
    // console.error("WebSocket error:", error);
  }

  private insert(msg: Omit<ChatMessage, 'id'>): ChatMessage {
    const result = this.sql.exec(
      "INSERT INTO messages (type, user, text, timestamp) VALUES (?, ?, ?, ?) RETURNING id",
      msg.type,
      msg.user,
      msg.text,
      msg.timestamp,
    );
    return { ...msg, id: (result.one() as { id: number }).id };
  }

  private broadcastSystem(text: string) {
    const msg = this.insert({ type: MSG_TYPE.SYSTEM, user: "system", text, timestamp: Date.now() });
    this.broadcast({ type: MSG_TYPE.SYSTEM, id: msg.id, text: msg.text });
  }

  private broadcast(msg: OutboundMessage) {
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