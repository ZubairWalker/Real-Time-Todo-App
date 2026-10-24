import { Document, Types } from "mongoose";

export type Priority = "LOW" | "MEDIUM" | "HIGH";

export interface ITodo extends Document {
  _id: Types.ObjectId;
  title: string;
  completed: boolean;
  dueDate: Date | null;
  priority: Priority;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTodoDTO {
  title: string;
  completed?: boolean;
  dueDate?: Date | string | null;
  priority?: Priority;
}

export interface UpdateTodoDTO {
  title?: string;
  completed?: boolean;
  dueDate?: Date | string | null;
  priority?: Priority;
}

export interface GetTodosQuery {
  completed?: string | boolean;
  sortBy?: "createdAt" | "dueDate";
  order?: "asc" | "desc";
  page?: string | number;
  limit?: string | number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface GetTodosResponse {
  todos: ITodo[];
  pagination: PaginationMeta;
}
