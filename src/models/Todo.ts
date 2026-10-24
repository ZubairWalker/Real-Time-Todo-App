import mongoose, { Schema } from "mongoose";
import { ITodo } from "../types/todo.js";

const todoSchema = new Schema<ITodo>(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      minlength: [1, "Title cannot be empty"],
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    completed: {
      type: Boolean,
      default: false,
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
      index: true,
    },
    priority: {
      type: String,
      enum: {
        values: ["LOW", "MEDIUM", "HIGH"],
        message: "Priority must be LOW, MEDIUM, or HIGH",
      },
      default: "MEDIUM",
      uppercase: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for ordering by creation date
todoSchema.index({ createdAt: -1 });

export const Todo = mongoose.model<ITodo>("Todo", todoSchema);
export default Todo;
