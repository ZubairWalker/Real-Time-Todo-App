import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import {
  getAllTodosService,
  getTodoByIdService,
  createTodoService,
  updateTodoService,
  deleteTodoService,
} from "../services/todoService.js";
import { CreateTodoDTO, GetTodosQuery, Priority, UpdateTodoDTO } from "../types/todo.js";
import { TypedSocketServer, getSocketServer } from "../socket/index.js";

const DEFAULT_WORKSPACE_ROOM = "workspace:default";
const allowedPriorities: Priority[] = ["LOW", "MEDIUM", "HIGH"];
const allowedUpdateFields = ["title", "completed", "dueDate", "priority"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isValidDate = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" &&
    value.trim().length > 0 &&
    !Number.isNaN(new Date(value).getTime()));

const isValidPriority = (value: unknown): value is Priority =>
  typeof value === "string" && allowedPriorities.includes(value as Priority);

const sendValidationError = (res: Response, error: string): void => {
  res.status(400).json({
    success: false,
    error: `Validation Error: ${error}`,
  });
};

/**
 * Helper to safely obtain the active Socket.IO server instance
 */
function getIO(customIo?: TypedSocketServer): TypedSocketServer | null {
  if (customIo) return customIo;
  try {
    return getSocketServer();
  } catch {
    return null;
  }
}

/**
 * Controller: Get All Todos
 * GET /api/todos
 */
export const getTodos = async (
  req: Request<{}, {}, {}, GetTodosQuery>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await getAllTodosService(req.query);
    res.status(200).json({
      success: true,
      data: result.todos,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller: Get Single Todo by ID
 * GET /api/todos/:id
 */
export const getTodoById = async (
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid Todo ID format",
      });
      return;
    }

    const todo = await getTodoByIdService(id);

    if (!todo) {
      res.status(404).json({
        success: false,
        error: `Todo with ID ${id} not found`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: todo,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller Factory: Create Todo and broadcast event via Socket.IO
 * POST /api/todos
 */
export const createTodo = (customIo?: TypedSocketServer) => async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const body: unknown = req.body;

    if (!isRecord(body)) {
      sendValidationError(res, "Request body must be an object");
      return;
    }

    const { title, completed, dueDate, priority } = body;
    const trimmedTitle = typeof title === "string" ? title.trim() : "";

    if (trimmedTitle.length < 1 || trimmedTitle.length > 100) {
      sendValidationError(res, "Title must be a trimmed string between 1 and 100 characters");
      return;
    }
    if (completed !== undefined && typeof completed !== "boolean") {
      sendValidationError(res, "Completed must be a boolean");
      return;
    }
    if (dueDate !== undefined && !isValidDate(dueDate)) {
      sendValidationError(res, "Due date must be a valid date string or null");
      return;
    }
    if (priority !== undefined && !isValidPriority(priority)) {
      sendValidationError(res, "Priority must be LOW, MEDIUM, or HIGH");
      return;
    }

    const todoData: CreateTodoDTO = { title: trimmedTitle };
    if (completed !== undefined) todoData.completed = completed;
    if (dueDate !== undefined) todoData.dueDate = dueDate;
    if (priority !== undefined) todoData.priority = priority;

    // 1. Write to Database first (Database is the single source of truth)
    const newTodo = await createTodoService(todoData);

    // 2. Broadcast real-time event to workspace:default only after DB write succeeds
    const io = getIO(customIo);
    if (io) {
      io.to(DEFAULT_WORKSPACE_ROOM).emit("todo:created", newTodo);
      console.log(`📢 [Socket] Broadcast 'todo:created' to ${DEFAULT_WORKSPACE_ROOM}: ${newTodo._id}`);
    }

    res.status(201).json({
      success: true,
      data: newTodo,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller Factory: Update Todo and broadcast event via Socket.IO
 * PUT/PATCH /api/todos/:id
 */
export const updateTodo = (customIo?: TypedSocketServer) => async (
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid Todo ID format",
      });
      return;
    }

    const body: unknown = req.body;

    if (!isRecord(body) || Object.keys(body).length === 0) {
      sendValidationError(res, "Update body must be a non-empty object");
      return;
    }

    const unsupportedFields = Object.keys(body).filter(
      (field) => !allowedUpdateFields.includes(field)
    );
    if (unsupportedFields.length > 0) {
      sendValidationError(res, `Unsupported update field(s): ${unsupportedFields.join(", ")}`);
      return;
    }

    const { title, completed, dueDate, priority } = body;
    const updateData: UpdateTodoDTO = {};

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim().length < 1 || title.trim().length > 100) {
        sendValidationError(res, "Title must be a trimmed string between 1 and 100 characters");
        return;
      }
      updateData.title = title.trim();
    }
    if (completed !== undefined) {
      if (typeof completed !== "boolean") {
        sendValidationError(res, "Completed must be a boolean");
        return;
      }
      updateData.completed = completed;
    }
    if (dueDate !== undefined) {
      if (!isValidDate(dueDate)) {
        sendValidationError(res, "Due date must be a valid date string or null");
        return;
      }
      updateData.dueDate = dueDate;
    }
    if (priority !== undefined) {
      if (!isValidPriority(priority)) {
        sendValidationError(res, "Priority must be LOW, MEDIUM, or HIGH");
        return;
      }
      updateData.priority = priority;
    }

    // 1. Write to Database first
    const updatedTodo = await updateTodoService(id, updateData);

    if (!updatedTodo) {
      res.status(404).json({
        success: false,
        error: `Todo with ID ${id} not found`,
      });
      return;
    }

    // 2. Broadcast real-time event to workspace:default only after DB write succeeds
    const io = getIO(customIo);
    if (io) {
      io.to(DEFAULT_WORKSPACE_ROOM).emit("todo:updated", updatedTodo);
      console.log(`📢 [Socket] Broadcast 'todo:updated' to ${DEFAULT_WORKSPACE_ROOM}: ${updatedTodo._id}`);
    }

    res.status(200).json({
      success: true,
      data: updatedTodo,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller Factory: Delete Todo and broadcast event via Socket.IO
 * DELETE /api/todos/:id
 */
export const deleteTodo = (customIo?: TypedSocketServer) => async (
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid Todo ID format",
      });
      return;
    }

    // 1. Delete from Database first
    const deletedTodo = await deleteTodoService(id);

    if (!deletedTodo) {
      res.status(404).json({
        success: false,
        error: `Todo with ID ${id} not found`,
      });
      return;
    }

    // 2. Broadcast real-time event to workspace:default only after DB write succeeds
    const io = getIO(customIo);
    if (io) {
      io.to(DEFAULT_WORKSPACE_ROOM).emit("todo:deleted", { id });
      console.log(`📢 [Socket] Broadcast 'todo:deleted' to ${DEFAULT_WORKSPACE_ROOM}: ${id}`);
    }

    res.status(200).json({
      success: true,
      message: "Todo deleted successfully",
      id,
    });
  } catch (error) {
    next(error);
  }
};
