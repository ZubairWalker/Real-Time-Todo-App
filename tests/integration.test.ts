import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { io as ClientSocket, Socket as ClientSocketType } from "socket.io-client";
import mongoose from "mongoose";
import { configureSocketServer } from "../src/socket/index.js";
import { createTodoRouter } from "../src/routes/todos.js";
import {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  PresencePayload,
  TodoDeletedPayload,
  TypingPayload,
} from "../src/types/socket.js";
import { ITodo } from "../src/types/todo.js";

const TEST_PORT = 5055;
const TEST_WORKSPACE = "default";
const SERVER_URL = `http://localhost:${TEST_PORT}`;

async function isMongoAvailable(): Promise<boolean> {
  if (process.env.TEST_MONGO_URI) return true;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(27017, "127.0.0.1");
  });
}

const mongoAvailable = await isMongoAvailable();

describe(
  "Real-time Collaborative TODO Integration Suite",
  {
    skip: !mongoAvailable
      ? "Skipped: MongoDB is not running locally (start mongod or set TEST_MONGO_URI)"
      : false,
  },
  () => {
  let server: http.Server;
  let ioServer: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  let clientA: ClientSocketType<ServerToClientEvents, ClientToServerEvents>;
  let clientB: ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

  before(async () => {
    // Connect to test MongoDB (fallback to localhost:27017/test_realtime)
    const mongoUri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017/test_realtime_todo";
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2500 });

    // Setup Express App + Socket.IO
    const app = express();
    app.use(express.json());

    server = http.createServer(app);
    ioServer = new SocketIOServer(server, { cors: { origin: "*" } });

    configureSocketServer(ioServer);
    app.use("/api/todos", createTodoRouter(ioServer));

    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, () => resolve());
    });
  });

  after(async () => {
    if (clientA?.connected) clientA.disconnect();
    if (clientB?.connected) clientB.disconnect();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.db?.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it("Scenario 4: Presence tracking - Client A and B join workspace:default and see updated online counts", async () => {
    // 1. Client A connects and joins
    clientA = ClientSocket(SERVER_URL, { reconnection: false });

    const clientAPresencePromise = new Promise<PresencePayload>((resolve) => {
      clientA.on("presence:update", (payload) => {
        resolve(payload);
      });
    });

    await new Promise<void>((resolve) => clientA.on("connect", () => resolve()));
    clientA.emit("workspace:join", { workspace: TEST_WORKSPACE, username: "Alice" });

    const presenceA = await clientAPresencePromise;
    assert.equal(presenceA.workspace, TEST_WORKSPACE);
    assert.equal(presenceA.online, 1);
    assert.deepEqual(presenceA.users, ["Alice"]);

    // 2. Client B connects and joins
    clientB = ClientSocket(SERVER_URL, { reconnection: false });

    const clientBPresencePromise = new Promise<PresencePayload>((resolve) => {
      clientA.once("presence:update", (payload) => {
        resolve(payload);
      });
    });

    await new Promise<void>((resolve) => clientB.on("connect", () => resolve()));
    clientB.emit("workspace:join", { workspace: TEST_WORKSPACE, username: "Bob" });

    const presenceAB = await clientBPresencePromise;
    assert.equal(presenceAB.online, 2);
    assert.ok(presenceAB.users.includes("Alice"));
    assert.ok(presenceAB.users.includes("Bob"));
  });

  it("Scenario 1: Real-time create - REST POST /api/todos broadcasts todo:created to other clients", async () => {
    const todoCreatedPromise = new Promise<ITodo>((resolve) => {
      clientB.once("todo:created", (todo) => {
        resolve(todo);
      });
    });

    // Make REST write (Client A creating a todo)
    const response = await fetch(`${SERVER_URL}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test Real-time Architecture",
        priority: "HIGH",
      }),
    });

    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.data.title, "Test Real-time Architecture");

    // Verify Client B received the real-time event instantly
    const receivedTodo = await todoCreatedPromise;
    assert.equal(receivedTodo._id, result.data._id);
    assert.equal(receivedTodo.title, "Test Real-time Architecture");
    assert.equal(receivedTodo.priority, "HIGH");
  });

  it("Scenario 2: Real-time update - REST PATCH /api/todos/:id broadcasts todo:updated to other clients", async () => {
    // First fetch existing todos
    const getRes = await fetch(`${SERVER_URL}/api/todos`);
    const getData = await getRes.json();
    const targetTodo = getData.data[0];
    assert.ok(targetTodo, "Todo should exist for update test");

    const todoUpdatedPromise = new Promise<ITodo>((resolve) => {
      clientB.once("todo:updated", (todo) => {
        resolve(todo);
      });
    });

    // Make REST update (toggle completed)
    const updateRes = await fetch(`${SERVER_URL}/api/todos/${targetTodo._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        completed: true,
      }),
    });

    assert.equal(updateRes.status, 200);
    const updateResult = await updateRes.json();
    assert.equal(updateResult.success, true);
    assert.equal(updateResult.data.completed, true);

    // Verify Client B received the real-time update
    const updatedPayload = await todoUpdatedPromise;
    assert.equal(updatedPayload._id, targetTodo._id);
    assert.equal(updatedPayload.completed, true);
  });

  it("Scenario 5: Typing indicator - Client A emits typing, Client B receives typing:update", async () => {
    const typingPromise = new Promise<TypingPayload>((resolve) => {
      clientB.once("typing:update", (payload) => {
        resolve(payload);
      });
    });

    clientA.emit("typing", {
      workspace: TEST_WORKSPACE,
      isTyping: true,
      username: "Alice",
    });

    const typingData = await typingPromise;
    assert.equal(typingData.workspace, TEST_WORKSPACE);
    assert.equal(typingData.username, "Alice");
    assert.equal(typingData.isTyping, true);
  });

  it("Scenario 3: Real-time delete - REST DELETE /api/todos/:id broadcasts todo:deleted to other clients", async () => {
    const getRes = await fetch(`${SERVER_URL}/api/todos`);
    const getData = await getRes.json();
    const targetTodo = getData.data[0];

    const todoDeletedPromise = new Promise<TodoDeletedPayload>((resolve) => {
      clientB.once("todo:deleted", (payload) => {
        resolve(payload);
      });
    });

    // Make REST delete
    const deleteRes = await fetch(`${SERVER_URL}/api/todos/${targetTodo._id}`, {
      method: "DELETE",
    });

    assert.equal(deleteRes.status, 200);

    // Verify Client B received the real-time delete event
    const deletedPayload = await todoDeletedPromise;
    assert.equal(deletedPayload.id, targetTodo._id);
  });

  it("Scenario 4 (cleanup): Disconnect updates presence for remaining clients", async () => {
    const presencePromise = new Promise<PresencePayload>((resolve) => {
      clientA.once("presence:update", (payload) => {
        resolve(payload);
      });
    });

    // Client B leaves / disconnects
    clientB.disconnect();

    const finalPresence = await presencePromise;
    assert.equal(finalPresence.online, 1);
    assert.deepEqual(finalPresence.users, ["Alice"]);
  });
});
