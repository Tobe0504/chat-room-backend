import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import RoomManager from "../utils/roomManager";

export function registerRoomHandlers(
  io: Server,
  socket: Socket,
  prisma: PrismaClient
) {
  const TypingManager: Record<string, Set<string>> = {};

  socket.on("createRoom", async ({ name, username }, callback) => {
    try {
      const existingRoom = await prisma.room.findUnique({ where: { name } });
      if (existingRoom) {
        return callback({ success: false, message: "Room already exists" });
      }

      let user = await prisma.user.findUnique({ where: { username } });
      if (!user) {
        user = await prisma.user.create({ data: { username } });
      }

      const room = await prisma.room.create({
        data: { name, ownerId: user.id },
      });

      await prisma.roomUser.create({
        data: { userId: user.id, roomId: room.id },
      });

      socket.join(room.name);

      RoomManager.addUser(room.name, socket.id, user.id, user.username);

      setTimeout(() => {
        io.to(room.name).emit(
          "userListUpdate",
          RoomManager.getUsers(room.name)
        );
      }, 50);

      callback({
        success: true,
        roomName: room.name,
        userId: user.id,
        username: user.username,
      });
    } catch (err) {
      console.error("createRoom error:", err);
      callback({ success: false, message: "Failed to create room" });
    }
  });

  socket.on("joinRoom", async ({ roomName, username }, callback) => {
    try {
      const normalizedUsername = username.trim();

      let user = await prisma.user.findUnique({
        where: { username: normalizedUsername },
      });

      if (!user) {
        user = await prisma.user.create({
          data: { username: normalizedUsername },
        });
      }

      let room = await prisma.room.findUnique({ where: { name: roomName } });
      if (!room) {
        room = await prisma.room.create({
          data: { name: roomName, ownerId: user.id },
        });
      }

      await prisma.roomUser.upsert({
        where: {
          userId_roomId: {
            userId: user.id,
            roomId: room.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roomId: room.id,
        },
      });

      socket.join(room.name);

      RoomManager.addUser(room.name, socket.id, user.id, normalizedUsername);

      setTimeout(() => {
        io.to(room.name).emit("userJoined", { username: normalizedUsername });
        io.to(room.name).emit(
          "userListUpdate",
          RoomManager.getUsers(room.name)
        );
      }, 50);

      callback({ success: true, roomName: room.name, userId: user.id });
    } catch (err) {
      console.error("joinRoom error:", err);
      callback({ success: false, message: "Failed to join room" });
    }
  });

  socket.on("leaveRoom", async ({ roomName, username }, callback) => {
    try {
      const user = await prisma.user.findUnique({ where: { username } });
      const room = await prisma.room.findUnique({ where: { name: roomName } });

      if (!user || !room) {
        return callback?.({
          success: false,
          message: "User or room not found",
        });
      }

      await prisma.roomUser.deleteMany({
        where: { userId: user.id, roomId: room.id },
      });

      let newOwnerUsername: string | null = null;

      if (room.ownerId === user.id) {
        const remainingUsers = await prisma.roomUser.findMany({
          where: { roomId: room.id },
          include: { user: true },
        });

        if (remainingUsers.length > 0) {
          const newOwner = remainingUsers[0].user;

          await prisma.room.update({
            where: { id: room.id },
            data: { ownerId: newOwner.id },
          });

          newOwnerUsername = newOwner.username;

          io.to(room.name).emit("ownerChanged", {
            newOwnerId: newOwner.id,
            newOwnerUsername: newOwner.username,
          });

          console.log(`Room owner reassigned to ${newOwner.username}`);
        } else {
          console.log("No users left to reassign ownership.");
        }
      }

      socket.leave(room.name);
      RoomManager.removeUser(room.name, socket.id);

      setTimeout(() => {
        io.to(room.name).emit("userLeft", { username });
        io.to(room.name).emit(
          "userListUpdate",
          RoomManager.getUsers(room.name)
        );
      }, 50);

      callback?.({
        success: true,
        message: `Left room ${room.name} successfully`,
        newOwner: newOwnerUsername,
      });
    } catch (err) {
      console.error("leaveRoom error:", err);
      callback?.({ success: false, message: "Failed to leave room" });
    }
  });

  socket.on("getUserRooms", async ({ username }, callback) => {
    try {
      const user = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (!user) {
        return callback({ success: false, message: "User not found" });
      }

      const rooms = await prisma.room.findMany({
        where: { users: { some: { userId: user.id } } },
        include: { users: { include: { user: true } } },
      });

      callback({ success: true, rooms });
    } catch (err) {
      console.error("getUserRooms error:", err);
      callback({ success: false, message: "Failed to fetch user rooms" });
    }
  });

  socket.on("typing", ({ roomName, username }) => {
    if (!roomName || !username) {
      console.error("Invalid typing event data:", { roomName, username });
      return;
    }

    if (!socket.rooms.has(roomName)) {
      console.warn(`Socket ${socket.id} is not in room ${roomName}`);
      return;
    }

    if (!TypingManager[roomName]) TypingManager[roomName] = new Set();
    TypingManager[roomName].add(username);

    io.to(roomName).emit("typingUpdate", {
      usersTyping: Array.from(TypingManager[roomName]),
    });
  });

  socket.on("stopTyping", ({ roomName, username }) => {
    if (!roomName || !username) {
      console.error("Invalid stopTyping event data:", { roomName, username });
      return;
    }

    if (!socket.rooms.has(roomName)) {
      console.warn(`Socket ${socket.id} is not in room ${roomName}`);
      return;
    }

    TypingManager[roomName]?.delete(username);

    io.to(roomName).emit("typingUpdate", {
      usersTyping: Array.from(TypingManager[roomName] || []),
    });
  });

  socket.on(
    "sendMessage",
    async ({ roomName, username, message }, callback) => {
      try {
        const user = await prisma.user.findUnique({ where: { username } });
        const room = await prisma.room.findUnique({
          where: { name: roomName },
        });

        if (!user || !room) {
          return callback?.({
            success: false,
            message: "Invalid user or room",
          });
        }

        const savedMessage = await prisma.message.create({
          data: {
            content: message,
            senderId: user?.id,
            roomId: room.id,
          },
          include: {
            sender: true,
          },
        });

        const chatMessage = {
          id: savedMessage.id,
          username: savedMessage.sender?.username,
          message: savedMessage.content,
          timestamp: savedMessage.createdAt,
          type: "chat",
        };

        io.to(room.name).emit("newMessage", chatMessage);

        callback?.({ success: true });
      } catch (err) {
        console.error("sendMessage error:", err);
        callback?.({ success: false, message: "Failed to send message" });
      }
    }
  );

  socket.on("getRoomMessages", async ({ roomName }, callback) => {
    try {
      const room = await prisma.room.findUnique({ where: { name: roomName } });
      if (!room) return callback({ success: false, message: "Room not found" });

      const messages = await prisma.message.findMany({
        where: { roomId: room.id },
        include: { sender: true },
        orderBy: { createdAt: "asc" },
      });

      callback({
        success: true,
        messages: messages.map((msg) => ({
          id: msg.id,
          username: msg.sender.username,
          message: msg.content,
          timestamp: msg.createdAt,
          type: "chat",
        })),
      });
    } catch (err) {
      console.error("getRoomMessages error:", err);
      callback({ success: false, message: "Failed to load messages" });
    }
  });

  socket.on("disconnect", () => {
    const data = RoomManager.findUser(socket.id);
    if (!data) return;

    const { roomId: roomName, user } = data;

    RoomManager.removeUser(roomName, socket.id);

    io.to(roomName).emit("userLeft", { username: user.username });
    io.to(roomName).emit("userListUpdate", RoomManager.getUsers(roomName));
  });

  socket.on("removeUserFromRoom", async ({ roomName, username }, callback) => {
    try {
      const room = await prisma.room.findUnique({ where: { name: roomName } });
      if (!room) return;

      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) return;

      await prisma.roomUser.delete({
        where: {
          userId_roomId: {
            userId: user.id,
            roomId: room.id,
          },
        },
      });

      const socketIdToRemove = RoomManager.getSocketIdByUsername(
        room.name,
        username
      );
      if (socketIdToRemove) {
        RoomManager.removeUser(room.name, socketIdToRemove);
      }

      io.to(room.name).emit("userRemoved", { username });

      io.to(room.name).emit("userListUpdate", RoomManager.getUsers(room.name));

      if (socketIdToRemove) {
        io.to(socketIdToRemove).emit("kickedFromRoom", { roomName });
      }

      callback({
        success: true,
      });
    } catch (error) {
      console.error("Error in removeUserFromRoom:", error);
      callback({ success: false, message: "Failed to remove user" });
    }
  });

  socket.on("checkRoom", async (roomName: string, callback) => {
    try {
      const room = await prisma.room.findUnique({
        where: { name: roomName },
        include: {
          users: {
            include: { user: true },
          },
        },
      });

      if (!room) {
        return callback({ success: false, message: "Room not found" });
      }

      const participants = room?.users?.map((ru) => ru.user.username);

      callback({
        success: true,
        room: {
          name: room.name,
          id: room.id,
          ownerId: room.ownerId,
          participants,
        },
      });
    } catch (err) {
      console.error("checkRoom error:", err);
      callback({ success: false, message: "Internal server error" });
    }
  });

  socket.on("checkRooms", () => {
    const rooms = [...socket.rooms];
    console.log(`${socket.id} is in rooms:`, rooms);
  });
}
