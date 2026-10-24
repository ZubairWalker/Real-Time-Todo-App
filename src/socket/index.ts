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

/**
 * Normalizes the room name for Socket.IO (e.g. "default" -> "workspace:default")
 */
export function getRoomName(workspace: string): string {
  return workspace.startsWith("workspace:") ? workspace : `workspace:${workspace}`;
}

/**
 * Normalizes the workspace display identifier (e.g. "workspace:default" -> "default")
 */
export function getWorkspaceKey(workspace: string): string {
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
    socket.on("workspace:join", ({ workspace, username }: WorkspaceJoinPayload) => {
      const room = getRoomName(workspace);
      const cleanWorkspace = getWorkspaceKey(workspace);
      const cleanUsername = username?.trim() || `Guest-${socket.id.slice(0, 4)}`;

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
    });

    // Client explicitly leaves a workspace
    socket.on("workspace:leave", ({ workspace }: WorkspaceLeavePayload) => {
      const room = getRoomName(workspace);
      const cleanWorkspace = getWorkspaceKey(workspace);

      void socket.leave(room);

      const presence = presenceManager.leave(cleanWorkspace, socket.id);
      if (presence) {
        console.log(`👋 [Socket] Client ${socket.id} left ${room}`);
        io.to(room).emit("presence:update", presence);
      }
    });

    // Typing indicator (Bonus Feature)
    socket.on("typing", ({ workspace, isTyping, username }: ClientTypingPayload) => {
      const room = getRoomName(workspace);
      const cleanWorkspace = getWorkspaceKey(workspace);
      const sender = username || socket.data.username || "Someone";

      // Broadcast typing update to all others in the room (exclude sender)
      socket.to(room).emit("typing:update", {
        workspace: cleanWorkspace,
        username: sender,
        isTyping,
      });
    });

    // Handle client disconnect
    socket.on("disconnect", (reason) => {
      console.log(`❌ [Socket] Client disconnected: ${socket.id} (${reason})`);

      // Clean up presence across any workspaces this socket was part of
      const affected = presenceManager.handleDisconnect(socket.id);

      for (const { workspace, payload } of affected) {
        const room = getRoomName(workspace);
        console.log(`📉 [Socket] Presence update for ${room}: ${payload.online} online`);
        io.to(room).emit("presence:update", payload);
      }
    });
  });
}
