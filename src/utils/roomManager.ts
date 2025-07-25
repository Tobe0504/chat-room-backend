type User = {
  id: string;
  username: string;
};

class RoomManager {
  private rooms: Record<string, Record<string, User>> = {};

  addUser(roomId: string, socketId: string, userId: string, username: string) {
    if (!this.rooms[roomId]) this.rooms[roomId] = {};
    this.rooms[roomId][socketId] = { id: userId, username };
  }

  removeUser(roomId: string, socketId: string) {
    if (this.rooms[roomId]) {
      delete this.rooms[roomId][socketId];
      if (Object.keys(this.rooms[roomId]).length === 0) {
        delete this.rooms[roomId];
      }
    }
  }

  getUsers(roomId: string): User[] {
    return Object.values(this.rooms[roomId] || {});
  }

  findUser(socketId: string): { roomId: string; user: User } | null {
    for (const [roomId, users] of Object.entries(this.rooms)) {
      if (users[socketId]) return { roomId, user: users[socketId] };
    }
    return null;
  }

  getSocketIdByUsername(roomId: string, username: string): string | null {
    const users = this.rooms[roomId];
    if (!users) return null;

    for (const [socketId, storedUsername] of Object.entries(users)) {
      if (storedUsername?.username === username) return socketId;
    }
    return null;
  }
}

export default new RoomManager();
