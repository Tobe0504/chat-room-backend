import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (_, res) => res.send("Chat server running"));

export default app;
