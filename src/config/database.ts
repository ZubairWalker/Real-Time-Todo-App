import mongoose from "mongoose";

export async function connectDatabase(): Promise<boolean> {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.warn("⚠️ [Database] MONGO_URI is not defined in environment variables.");
    return false;
  }

  if (uri.includes("<db_username>")) {
    console.warn(
      "⚠️ [Database] MONGO_URI contains the placeholder '<db_username>'. Please provide your Atlas database username in .env!"
    );
    return false;
  }

  try {
    mongoose.connection.on("connected", () => {
      console.log("✅ [Database] MongoDB connected successfully.");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ [Database] MongoDB connection error:", err.message);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ [Database] MongoDB disconnected.");
    });

    await mongoose.connect(uri);
    return true;
  } catch (error: any) {
    console.error("❌ [Database] Failed to connect to MongoDB:", error.message);
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("🛑 [Database] MongoDB disconnected cleanly.");
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
