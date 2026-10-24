import { ITodo } from "./todo.js";

export interface PresencePayload {
  workspace: string;
  online: number;
  users: string[];
}

export interface TodoDeletedPayload {
  id: string;
}

export interface TypingPayload {
  workspace: string;
  username: string;
  isTyping: boolean;
}

export interface WorkspaceJoinPayload {
  workspace: string;
  username: string;
}

export interface WorkspaceLeavePayload {
  workspace: string;
}

export interface ClientTypingPayload {
  workspace: string;
  isTyping: boolean;
  username?: string;
}

// Events sent from Server to Client
export interface ServerToClientEvents {
  "todo:created": (todo: ITodo) => void;
  "todo:updated": (todo: ITodo) => void;
  "todo:deleted": (payload: TodoDeletedPayload) => void;
  "presence:update": (payload: PresencePayload) => void;
  "typing:update": (payload: TypingPayload) => void;
}

// Events sent from Client to Server
export interface ClientToServerEvents {
  "workspace:join": (payload: WorkspaceJoinPayload) => void;
  "workspace:leave": (payload: WorkspaceLeavePayload) => void;
  "typing": (payload: ClientTypingPayload) => void;
}

// Inter-server events (not used here, but good practice)
export interface InterServerEvents {}

// Socket session data
export interface SocketData {
  username?: string;
  workspace?: string;
}
