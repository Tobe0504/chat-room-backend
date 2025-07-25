import app, { prisma } from "./app";
import { createServer } from "http";
import { Server } from "socket.io";
import { registerRoomHandlers } from "./sockets/roomHandlers";

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin:
      "http://localhost:3000, http://localhost:3001, http://localhost:3002",
  },
});

io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id);
  registerRoomHandlers(io, socket, prisma);
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, async () => {
  try {
    console.log(`🚀 Server running on http://localhost:${PORT}`);

    await prisma.$connect();
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
});
