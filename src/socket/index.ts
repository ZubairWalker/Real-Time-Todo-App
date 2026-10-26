import { Server, Socket } from "socket.io";
import {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  WorkspaceJoinPayload,
  WorkspaceLeavePayload,
  ClientTypingPayload,
} from "../types/socket.js";
import { presenceManager } from "./presence.js";

export type TypedSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export const MAX_USERNAME_LENGTH = 32;

/**
 * Checks whether an untrusted socket payload is an object and contains a valid workspace string.
 */
export function isValidWorkspacePayload(
  payload: unknown
): payload is { workspace: string; [key: string]: unknown } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return typeof candidate.workspace === "string" && candidate.workspace.trim().length > 0;
}

/**
 * Normalizes the room name for Socket.IO (e.g. "default" -> "workspace:default")
 */
export function getRoomName(workspace: string): string {
  if (typeof workspace !== "string") return "workspace:default";
  return workspace.startsWith("workspace:") ? workspace : `workspace:${workspace}`;
}

/**
 * Normalizes the workspace display identifier (e.g. "workspace:default" -> "default")
 */
export function getWorkspaceKey(workspace: string): string {
  if (typeof workspace !== "string") return "default";
  return workspace.replace(/^workspace:/, "");
}

let socketServerInstance: TypedSocketServer | null = null;

export function setSocketServer(io: TypedSocketServer): void {
  socketServerInstance = io;
}

export function getSocketServer(): TypedSocketServer {
  if (!socketServerInstance) {
    throw new Error("Socket server has not been initialized yet.");
  }
  return socketServerInstance;
}

export function configureSocketServer(io: TypedSocketServer): void {
  setSocketServer(io);

  io.on("connection", (socket: TypedSocket) => {
    console.log(`🔌 [Socket] Client connected: ${socket.id}`);

    // Client joins a workspace
    socket.on("workspace:join", (payload: WorkspaceJoinPayload) => {
      try {
        if (!isValidWorkspacePayload(payload)) {
          console.warn(`⚠️ [Socket] Ignored invalid "workspace:join" payload from ${socket.id}`);
          return;
        }

        const room = getRoomName(payload.workspace.trim());
        const cleanWorkspace = getWorkspaceKey(payload.workspace.trim());

        // Cap username length and sanitize
        let cleanUsername = `Guest-${socket.id.slice(0, 4)}`;
        if (typeof payload.username === "string" && payload.username.trim().length > 0) {
          cleanUsername = payload.username.trim().slice(0, MAX_USERNAME_LENGTH);
        }

        // Save user info in socket session data
        socket.data.username = cleanUsername;
        socket.data.workspace = cleanWorkspace;

        // Join the socket room
        void socket.join(room);

        // Track presence in memory
        const presence = presenceManager.join(cleanWorkspace, socket.id, cleanUsername);

        console.log(
          `👤 [Socket] ${cleanUsername} (${socket.id}) joined ${room}. Online: ${presence.online}`
        );

        // Broadcast updated presence to everyone in this workspace room
        io.to(room).emit("presence:update", presence);
      } catch (error) {
        console.error(`💥 [Socket] Error handling "workspace:join" from ${socket.id}:`, error);
      }
    });

    // Client explicitly leaves a workspace
    socket.on("workspace:leave", (payload: WorkspaceLeavePayload) => {
      try {
        if (!isValidWorkspacePayload(payload)) {
          console.warn(`⚠️ [Socket] Ignored invalid "workspace:leave" payload from ${socket.id}`);
          return;
        }

        const room = getRoomName(payload.workspace.trim());
        const cleanWorkspace = getWorkspaceKey(payload.workspace.trim());

        void socket.leave(room);

        const presence = presenceManager.leave(cleanWorkspace, socket.id);
        if (presence) {
          console.log(`👋 [Socket] Client ${socket.id} left ${room}`);
          io.to(room).emit("presence:update", presence);
        }
      } catch (error) {
        console.error(`💥 [Socket] Error handling "workspace:leave" from ${socket.id}:`, error);
      }
    });

    // Typing indicator (Bonus Feature)
    socket.on("typing", (payload: ClientTypingPayload) => {
      try {
        if (!isValidWorkspacePayload(payload)) {
          console.warn(`⚠️ [Socket] Ignored invalid "typing" payload from ${socket.id}`);
          return;
        }

        const room = getRoomName(payload.workspace.trim());
        const cleanWorkspace = getWorkspaceKey(payload.workspace.trim());
        const isTyping = Boolean(payload.isTyping);

        let sender = socket.data.username || "Someone";
        if (typeof payload.username === "string" && payload.username.trim().length > 0) {
          sender = payload.username.trim().slice(0, MAX_USERNAME_LENGTH);
        }

        // Broadcast typing update to all others in the room (exclude sender)
        socket.to(room).emit("typing:update", {
          workspace: cleanWorkspace,
          username: sender,
          isTyping,
        });
      } catch (error) {
        console.error(`💥 [Socket] Error handling "typing" from ${socket.id}:`, error);
      }
    });

    // Handle client disconnect
    socket.on("disconnect", (reason) => {
      try {
        console.log(`❌ [Socket] Client disconnected: ${socket.id} (${reason})`);

        // Clean up presence across any workspaces this socket was part of
        const affected = presenceManager.handleDisconnect(socket.id);

        for (const { workspace, payload } of affected) {
          const room = getRoomName(workspace);
          console.log(`📉 [Socket] Presence update for ${room}: ${payload.online} online`);
          io.to(room).emit("presence:update", payload);
        }
      } catch (error) {
        console.error(`💥 [Socket] Error during disconnect cleanup for ${socket.id}:`, error);
      }
    });
  });
}
