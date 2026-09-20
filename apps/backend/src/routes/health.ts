import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { redis } from "../db/redis.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisPong = await redis.ping();
    res.json({ ok: true, postgres: "ok", redis: redisPong });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Service Unavailable"
    });
  }
});
