import { Redis } from "ioredis";
import { config } from "../config/env.js";

export function createRedisConnection() {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
}

export const redis = createRedisConnection();
