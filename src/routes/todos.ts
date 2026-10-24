import express, { Router } from "express";
import {
  getTodos,
  getTodoById,
  createTodo,
  updateTodo,
  deleteTodo,
} from "../controllers/todoController.js";
import { TypedSocketServer } from "../socket/index.js";

export function createTodoRouter(io?: TypedSocketServer): Router {
  const router = express.Router();

  router
    .route("/")
    .get(getTodos)
    .post(createTodo(io));

  router
    .route("/:id")
    .get(getTodoById)
    .put(updateTodo(io))
    .patch(updateTodo(io))
    .delete(deleteTodo(io));

  return router;
}

export default createTodoRouter();
