import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { io as ClientSocket, Socket as ClientSocketType } from "socket.io-client";
import { configureSocketServer, MAX_USERNAME_LENGTH, isValidWorkspacePayload, getRoomName, getWorkspaceKey } from "../src/socket/index.js";
import {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  PresencePayload,
  TypingPayload,
} from "../src/types/socket.js";

const TEST_PORT = 5066;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

describe("Socket Input Validation & Resilience", () => {
  let server: http.Server;
  let ioServer: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  let client: ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

  before(async () => {
    server = http.createServer();
    ioServer = new SocketIOServer(server, { cors: { origin: "*" } });
    configureSocketServer(ioServer);

    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, () => resolve());
    });

    client = ClientSocket(SERVER_URL, { reconnection: false });
    await new Promise<void>((resolve) => client.on("connect", () => resolve()));
  });

  after(async () => {
    if (client?.connected) {
      client.disconnect();
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("Helper unit tests", () => {
    it("isValidWorkspacePayload correctly rejects non-objects, null, arrays, and missing/non-string workspaces", () => {
      assert.equal(isValidWorkspacePayload(undefined), false);
      assert.equal(isValidWorkspacePayload(null), false);
      assert.equal(isValidWorkspacePayload("workspace:default"), false);
      assert.equal(isValidWorkspacePayload(123), false);
      assert.equal(isValidWorkspacePayload([]), false);
      assert.equal(isValidWorkspacePayload({}), false);
      assert.equal(isValidWorkspacePayload({ workspace: 123 }), false);
      assert.equal(isValidWorkspacePayload({ workspace: null }), false);
      assert.equal(isValidWorkspacePayload({ workspace: "" }), false);
      assert.equal(isValidWorkspacePayload({ workspace: "   " }), false);
      assert.equal(isValidWorkspacePayload({ workspace: "team-a" }), true);
      assert.equal(isValidWorkspacePayload({ workspace: "workspace:team-a", username: "Alice" }), true);
    });

    it("getRoomName and getWorkspaceKey safely handle non-string inputs", () => {
      assert.equal(getRoomName("project"), "workspace:project");
      assert.equal(getRoomName("workspace:project"), "workspace:project");
      assert.equal(getRoomName(123 as unknown as string), "workspace:default");

      assert.equal(getWorkspaceKey("workspace:project"), "project");
      assert.equal(getWorkspaceKey("project"), "project");
      assert.equal(getWorkspaceKey(123 as unknown as string), "default");
    });
  });

  describe("Server survivability against malicious/malformed events", () => {
    it("does not crash on emit('workspace:join') with no payload", async () => {
      // @ts-expect-error Testing untrusted runtime payload without arguments
      client.emit("workspace:join");
      // Wait a moment to ensure server processed the event without crashing
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(client.connected, true, "Socket client should remain connected");
    });

    it("does not crash on emit('workspace:join', { workspace: 123 })", async () => {
      // @ts-expect-error Testing untrusted runtime payload with number workspace
      client.emit("workspace:join", { workspace: 123 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(client.connected, true, "Socket client should remain connected");
    });

    it("does not crash on emit('typing', null)", async () => {
      // @ts-expect-error Testing untrusted runtime payload with null
      client.emit("typing", null);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(client.connected, true, "Socket client should remain connected");
    });

    it("does not crash on emit('workspace:leave', {})", async () => {
      // @ts-expect-error Testing untrusted runtime payload with empty object
      client.emit("workspace:leave", {});
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(client.connected, true, "Socket client should remain connected");
    });

    it("caps oversized usernames to MAX_USERNAME_LENGTH", async () => {
      const longName = "A".repeat(100);
      const presencePromise = new Promise<PresencePayload>((resolve) => {
        client.once("presence:update", (payload) => resolve(payload));
      });

      client.emit("workspace:join", { workspace: "security-test", username: longName });
      const presence = await presencePromise;

      assert.equal(presence.workspace, "security-test");
      assert.equal(presence.users.length, 1);
      assert.equal(presence.users[0].length, MAX_USERNAME_LENGTH);
      assert.equal(presence.users[0], "A".repeat(MAX_USERNAME_LENGTH));
    });

    it("still processes valid workspace and typing events normally", async () => {
      let typingReceived: TypingPayload | null = null;
      const client2 = ClientSocket(SERVER_URL, { reconnection: false });

      await new Promise<void>((resolve) => client2.on("connect", () => resolve()));

      client2.on("typing:update", (payload) => {
        typingReceived = payload;
      });

      // Both join same workspace
      client.emit("workspace:join", { workspace: "chat-room", username: "Alice" });
      client2.emit("workspace:join", { workspace: "chat-room", username: "Bob" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Alice sends typing
      client.emit("typing", { workspace: "chat-room", isTyping: true, username: "Alice" });

      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.ok(typingReceived !== null);
      assert.equal((typingReceived as TypingPayload).username, "Alice");
      assert.equal((typingReceived as TypingPayload).isTyping, true);

      client2.disconnect();
    });
  });
});
