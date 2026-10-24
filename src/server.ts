import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { Server } from "socket.io";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "./types/socket.js";
import { configureSocketServer } from "./socket/index.js";
import { createTodoRouter } from "./routes/todos.js";
import {
  connectDatabase,
  disconnectDatabase,
  isDatabaseConnected,
} from "./config/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// 1. Initialize Typed Socket.IO Server attached to the HTTP server
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});

// 2. Attach Socket.IO connection handlers & presence tracking
configureSocketServer(io);

// 3. Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public")));

// 4. Request logger for visibility during development
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// 5. Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  const dbStatus = isDatabaseConnected();
  res.status(dbStatus ? 200 : 503).json({
    status: dbStatus ? "healthy" : "degraded",
    database: dbStatus ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// 6. Mount REST API routes with Socket.IO instance injected
app.use("/api/todos", createTodoRouter(io));

// 7. Global 404 Handler for API routes
app.use("/api/*", (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: "API endpoint not found",
  });
});

// 8. Global Error Handler
app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    console.error("Unhandled Server Error:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
);

// 9. Startup & Graceful Shutdown
const PORT = Number(process.env.PORT || 5000);

async function startServer(): Promise<void> {
  const dbConnected = await connectDatabase();
  if (!dbConnected) {
    console.warn(
      "⚠️ Server starting with database disconnected. Update MONGO_URI in .env to connect."
    );
  }

  server.listen(PORT, () => {
    console.log(`🚀 Server running smoothly on http://localhost:${PORT}`);
    console.log(`📡 Socket.IO server ready on ws://localhost:${PORT}`);
  });
}

async function shutdown(): Promise<void> {
  console.log("\n🛑 Gracefully shutting down server...");
  await disconnectDatabase();
  server.close(() => {
    console.log("🔒 Server closed.");
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

startServer().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
