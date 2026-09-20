import { Queue } from "bullmq";
import { config } from "../config/env.js";
import { createRedisConnection } from "../db/redis.js";

export type SendEmailJob = {
  emailId: string;
};

export const emailQueue = new Queue<SendEmailJob>(config.queue.name, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 10000
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60
    }
  }
});
