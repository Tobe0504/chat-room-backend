import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import RoomManager from "../utils/roomManager";

export default function registerSocketHandlers(
  io: Server,
  socket: Socket,
  prisma: PrismaClient
) {
  socket.on("joinRoom", async ({ roomId, username }) => {
    socket.join(roomId);
    RoomManager.addUser(roomId, socket.id, username);

    socket.to(roomId).emit("userJoined", { username });

    io.to(roomId).emit("userListUpdate", RoomManager.getUsers(roomId));
  });

  socket.on("typing", ({ roomId, username }) => {
    socket.to(roomId).emit("userTyping", { username });
  });

  socket.on("stopTyping", ({ roomId, username }) => {
    socket.to(roomId).emit("userStopTyping", { username });
  });

  socket.on("sendMessage", async ({ roomId, content, username }) => {
    const msg = await prisma.message.create({
      data: { roomId, sender: username, content },
    });
    io.to(roomId).emit("newMessage", msg);
  });

  socket.on("leaveRoom", ({ roomId, username }) => {
    socket.leave(roomId);
    RoomManager.removeUser(roomId, socket.id);

    socket.to(roomId).emit("userLeft", { username });

    io.to(roomId).emit("userListUpdate", RoomManager.getUsers(roomId));
  });

  socket.on("disconnect", () => {
    const { roomId, username } = RoomManager.findUser(socket.id) || {};
    if (roomId && username) {
      RoomManager.removeUser(roomId, socket.id);
      socket.to(roomId).emit("userLeft", { username });
      io.to(roomId).emit("userListUpdate", RoomManager.getUsers(roomId));
    }
  });
}
