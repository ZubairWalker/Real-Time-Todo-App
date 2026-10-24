import Todo from "../models/Todo.js";
import {
  ITodo,
  CreateTodoDTO,
  UpdateTodoDTO,
  GetTodosQuery,
  GetTodosResponse,
} from "../types/todo.js";

/**
 * Fetch all todos with optional filtering, sorting, and pagination
 */
export async function getAllTodosService(query: GetTodosQuery = {}): Promise<GetTodosResponse> {
  const { completed, sortBy, order, page, limit } = query;
  const hasPagination = page !== undefined || limit !== undefined;

  const filter: Record<string, any> = {};
  if (completed !== undefined) {
    filter.completed = completed === "true" || completed === true;
  }

  const allowedSortFields = ["createdAt", "dueDate", "title", "priority"];
  const sortField = sortBy && allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
  const sortOrder = order === "asc" ? 1 : -1;

  const pageNum = Math.max(typeof page === "string" ? parseInt(page, 10) : page || 1, 1);
  const limitNum = Math.min(
    Math.max(typeof limit === "string" ? parseInt(limit, 10) : limit || 50, 1),
    100
  );
  const skip = (pageNum - 1) * limitNum;

  const total = await Todo.countDocuments(filter);
  const todosQuery = Todo.find(filter).sort({ [sortField]: sortOrder });

  if (hasPagination) {
    todosQuery.skip(skip).limit(limitNum);
  }

  const todos = await todosQuery;
  const responseLimit = hasPagination ? limitNum : total || 1;

  return {
    todos,
    pagination: {
      total,
      page: pageNum,
      limit: responseLimit,
      totalPages: Math.ceil(total / responseLimit) || 1,
    },
  };
}

/**
 * Fetch a single todo by ID
 */
export async function getTodoByIdService(id: string): Promise<ITodo | null> {
  return await Todo.findById(id);
}

/**
 * Create a new todo in MongoDB
 */
export async function createTodoService(data: CreateTodoDTO): Promise<ITodo> {
  const todo = new Todo(data);
  return await todo.save();
}

/**
 * Update an existing todo by ID
 */
export async function updateTodoService(
  id: string,
  updateData: UpdateTodoDTO
): Promise<ITodo | null> {
  return await Todo.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });
}

/**
 * Delete a todo by ID
 */
export async function deleteTodoService(id: string): Promise<ITodo | null> {
  return await Todo.findByIdAndDelete(id);
}
