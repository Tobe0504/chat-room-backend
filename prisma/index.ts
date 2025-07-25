import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_, res) => res.send("Chat server running"));

export default app;
