# ⚡ Real-Time Collaborative TODO Application

An enterprise-grade, real-time collaborative TODO application built with **Express 4/5**, **TypeScript**, **MongoDB (Mongoose)**, and **Socket.IO**, featuring a live React frontend.

---

## 🌟 Architectural Overview: The "REST + WebSocket Hybrid" Pattern

In modern collaborative applications, a common architectural pitfall is trying to handle everything over WebSockets. Here, we follow the industry-standard **REST Write → Socket Broadcast** pattern:

```
[ Browser Tab A ]                      [ Node.js Server ]                      [ Browser Tab B ]
       |                                       |                                       |
       |--- 1. POST /api/todos (REST) -------->|                                       |
       |                                       |--- 2. Write to MongoDB ------------->| [ MongoDB ]
       |                                       |<-- 3. Document Saved Successfully ---|
       |<-- 4. 201 Created Response -----------|                                       |
       |                                       |                                       |
       |                                       |--- 5. io.to("workspace:default") ---->|
       |                                       |       emit("todo:created", todo)      |
       |                                       |                                       |
       |<== (Also receives broadcast) =========|                                       |==> (Instant UI Update)
```

### Core Principles
1. **Database is the Single Source of Truth**: All mutations (create, update, delete) go through validated REST endpoints first. If database validation or saving fails, no socket event is ever fired.
2. **WebSockets as Real-time Notifications**: Socket.IO events serve as real-time push notifications informing connected clients that state has changed.
3. **Room Isolation**: Connected clients join `workspace:default` (or custom workspaces), keeping network traffic scoped.
4. **In-Memory Presence Tracking**: Online users are maintained per workspace (`Map<workspace, Map<socketId, username>>`), handling connect, explicit leave, and graceful/ungraceful disconnects.

---

## 📂 Project Structure

```
Real-time-todo-app/
├── public/
│   └── index.html             # Collaborative React SPA (Tailwind + React 18 + Socket.IO)
├── src/
│   ├── server.ts              # Express app + HTTP server + Socket.IO server initialization
│   ├── config/
│   │   └── database.ts        # Mongoose connection with error handling and reconnection
│   ├── models/
│   │   └── Todo.ts            # Mongoose schema with timestamps and validation
│   ├── types/
│   │   ├── todo.ts            # Todo entity, DTOs, query, and pagination types
│   │   └── socket.ts          # Strictly typed Socket.IO event payloads and socket data
│   ├── services/
│   │   └── todoService.ts     # Data access layer for MongoDB CRUD operations
│   ├── socket/
│   │   ├── index.ts           # Socket.IO connection handler & room event routing
│   │   └── presence.ts        # In-memory Presence Manager
│   ├── controllers/
│   │   └── todoController.ts  # REST controllers that persist to DB and broadcast events
│   └── routes/
│       └── todos.ts           # Express router factory (/api/todos)
├── tests/
│   └── integration.test.ts    # End-to-end multi-client integration test suite
├── .env                       # Environment configuration
├── .env.example               # Example configuration template
├── package.json
└── tsconfig.json
```

---

## 🚀 Getting Started

### 1. Configure MongoDB Connection in `.env`
Open `.env` and fill in your MongoDB Atlas database username:

```env
PORT=5000
# Replace <db_username> with your MongoDB Atlas database username
MONGO_URI=mongodb+srv://<db_username>:<db_password>@realtimetodoapp.aqyrdnj.mongodb.net/realtime_todo?retryWrites=true&w=majority
NODE_ENV=development
```

> **Note**: If you are working offline or testing locally, you can also point `MONGO_URI` to a local MongoDB instance: `mongodb://localhost:27017/realtime_todo`.

### 2. Start the Development Server
```bash
npm run dev
```

The server will start at:
- **Web App & React Client**: [http://localhost:5000](http://localhost:5000)
- **REST API**: `http://localhost:5000/api/todos`
- **Socket.IO Endpoint**: `ws://localhost:5000`

### 3. Run the Automated Test Suite
To run the automated multi-client integration tests:
```bash
npm test
```

---

## 🧪 Self-Check Scenarios (Testing Multi-Tab Sync)

1. **Scenario 1 — Presence**:
   - Open [http://localhost:5000](http://localhost:5000) in **Tab A**.
   - Notice the badge says `1 online` with your generated username.
   - Open [http://localhost:5000](http://localhost:5000) in **Tab B**.
   - Both tabs immediately update to show `2 online` and display both usernames in the room!
   - Close Tab B — Tab A immediately decrements back to `1 online`.

2. **Scenario 2 — Real-Time Create**:
   - In Tab A, type a new task and click **Add Todo**.
   - Tab B displays the new task instantly without refreshing the page!

3. **Scenario 3 — Real-Time Update**:
   - In Tab A, click the checkbox to complete a task.
   - Tab B reflects the strikethrough and completed state instantly!

4. **Scenario 4 — Real-Time Delete**:
   - In Tab A, click the trash can icon to delete a task.
   - Tab B immediately removes the task from view!

5. **Scenario 5 — Typing Indicator (Bonus)**:
   - In Tab A, start typing in the input box.
   - Tab B displays *"✍️ [Name] is typing..."* above the input form!

---

## 📡 Socket.IO Event Contract

### Client → Server
| Event | Payload | Description |
| :--- | :--- | :--- |
| `workspace:join` | `{ workspace: "default", username: "Alice" }` | Joins a workspace room and updates presence |
| `workspace:leave` | `{ workspace: "default" }` | Leaves a workspace room and removes presence |
| `typing` | `{ workspace: "default", isTyping: true, username: "Alice" }` | Broadcasts typing activity to other room members |

### Server → Client
| Event | Payload | Description |
| :--- | :--- | :--- |
| `todo:created` | `ITodo` | Fired after successful `POST /api/todos` write |
| `todo:updated` | `ITodo` | Fired after successful `PATCH /api/todos/:id` write |
| `todo:deleted` | `{ id: "todoId" }` | Fired after successful `DELETE /api/todos/:id` |
| `presence:update` | `{ workspace: "default", online: number, users: string[] }` | Fired on client connect, join, leave, or disconnect |
| `typing:update` | `{ workspace: "default", username: string, isTyping: boolean }` | Broadcast to all room peers (excluding the sender) |

---

## 💡 Weaver Guidance: How to Become a Better Developer

1. **Strict Separation of Concerns**:
   - `services/todoService.ts` contains raw Mongoose logic and know nothing about HTTP or WebSockets.
   - `controllers/todoController.ts` orchestrates the HTTP request, invokes the service, and triggers the socket broadcast.
   - `socket/presence.ts` encapsulates in-memory state away from network listeners.

2. **Strict TypeScript Socket Interfaces**:
   By typing `Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>`, TypeScript will provide autocompletion and catch typos in event names or payload types at compile-time.

3. **Idempotency & Deduplication on the Client**:
   Network messages can occasionally arrive out of order or be duplicated. In the React client, always check `if (prev.some(t => t._id === newTodo._id)) return prev;` before appending items.

4. **Graceful Degradation**:
   Notice that in `src/server.ts`, if MongoDB fails to connect or is pending credentials, the server boots in a degraded state and `/api/health` reports status instead of crashing immediately.
