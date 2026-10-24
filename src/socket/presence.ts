import { PresencePayload } from "../types/socket.js";

/**
 * In-memory Presence Manager
 * Tracks online users per workspace room using:
 * Map<workspace, Map<socketId, username>>
 */
class PresenceManager {
  // workspace -> (socketId -> username)
  private workspaces = new Map<string, Map<string, string>>();

  /**
   * Add a socket to a workspace with their display username
   */
  public join(workspace: string, socketId: string, username: string): PresencePayload {
    if (!this.workspaces.has(workspace)) {
      this.workspaces.set(workspace, new Map());
    }

    const room = this.workspaces.get(workspace)!;
    room.set(socketId, username);

    return this.getPresence(workspace);
  }

  /**
   * Remove a socket from a specific workspace
   */
  public leave(workspace: string, socketId: string): PresencePayload | null {
    const room = this.workspaces.get(workspace);
    if (!room) return null;

    room.delete(socketId);
    if (room.size === 0) {
      this.workspaces.delete(workspace);
      return {
        workspace,
        online: 0,
        users: [],
      };
    }

    return this.getPresence(workspace);
  }

  /**
   * Handle socket disconnect by finding which workspaces they belonged to
   * and removing them, returning the updated presence payloads.
   */
  public handleDisconnect(socketId: string): Array<{ workspace: string; payload: PresencePayload }> {
    const affected: Array<{ workspace: string; payload: PresencePayload }> = [];

    for (const [workspace, room] of this.workspaces.entries()) {
      if (room.has(socketId)) {
        room.delete(socketId);
        const users = Array.from(room.values());
        const payload: PresencePayload = {
          workspace,
          online: users.length,
          users,
        };
        affected.push({ workspace, payload });

        if (room.size === 0) {
          this.workspaces.delete(workspace);
        }
      }
    }

    return affected;
  }

  /**
   * Get current presence snapshot for a workspace
   */
  public getPresence(workspace: string): PresencePayload {
    const room = this.workspaces.get(workspace);
    const users = room ? Array.from(room.values()) : [];
    return {
      workspace,
      online: users.length,
      users,
    };
  }
}

export const presenceManager = new PresenceManager();
