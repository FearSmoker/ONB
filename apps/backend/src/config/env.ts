import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const numberFromEnv = (fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number());

const booleanFromEnv = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true";
  }, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: numberFromEnv(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
  ELASTICSEARCH_API_KEY: z.string().optional().default(""),
  SESSION_SECRET: z.string().min(16),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_CALLBACK_URL: z.string().url().default("http://localhost:4000/api/auth/google/callback"),
  SLACK_CLIENT_ID: z.string().optional().default(""),
  SLACK_CLIENT_SECRET: z.string().optional().default(""),
  SLACK_REDIRECT_URI: z.string().url().default("http://localhost:4000/api/slack/callback"),
  SMTP_HOST: z.string().default("smtp.ethereal.email"),
  SMTP_PORT: numberFromEnv(587),
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM_NAME: z.string().default("ReachInbox Scheduler"),
  ETHEREAL_AUTO_CREATE: booleanFromEnv(true),
  EMAIL_QUEUE_NAME: z.string().default("email-send"),
  WORKER_CONCURRENCY: numberFromEnv(5),
  MIN_SEND_INTERVAL_MS: numberFromEnv(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: numberFromEnv(200),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(""),
  CLOUDINARY_API_KEY: z.string().optional().default(""),
  CLOUDINARY_API_SECRET: z.string().optional().default("")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  frontendUrl: parsed.data.FRONTEND_URL,
  apiBaseUrl: parsed.data.API_BASE_URL,
  databaseUrl: parsed.data.DATABASE_URL,
  redisUrl: parsed.data.REDIS_URL,
  elasticsearchUrl: parsed.data.ELASTICSEARCH_URL,
  elasticsearchApiKey: parsed.data.ELASTICSEARCH_API_KEY,
  sessionSecret: parsed.data.SESSION_SECRET,
  google: {
    clientId: parsed.data.GOOGLE_CLIENT_ID,
    clientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
    callbackUrl: parsed.data.GOOGLE_CALLBACK_URL,
    enabled: Boolean(parsed.data.GOOGLE_CLIENT_ID && parsed.data.GOOGLE_CLIENT_SECRET)
  },
  slack: {
    clientId: parsed.data.SLACK_CLIENT_ID,
    clientSecret: parsed.data.SLACK_CLIENT_SECRET,
    redirectUri: parsed.data.SLACK_REDIRECT_URI,
    enabled: Boolean(parsed.data.SLACK_CLIENT_ID && parsed.data.SLACK_CLIENT_SECRET)
  },
  smtp: {
    host: parsed.data.SMTP_HOST,
    port: parsed.data.SMTP_PORT,
    secure: parsed.data.SMTP_SECURE,
    user: parsed.data.SMTP_USER,
    pass: parsed.data.SMTP_PASS,
    fromName: parsed.data.SMTP_FROM_NAME,
    etherealAutoCreate: parsed.data.ETHEREAL_AUTO_CREATE
  },
  queue: {
    name: parsed.data.EMAIL_QUEUE_NAME,
    workerConcurrency: parsed.data.WORKER_CONCURRENCY,
    minSendIntervalMs: parsed.data.MIN_SEND_INTERVAL_MS,
    maxEmailsPerHourPerSender: parsed.data.MAX_EMAILS_PER_HOUR_PER_SENDER
  },
  cloudinary: {
    cloudName: parsed.data.CLOUDINARY_CLOUD_NAME,
    apiKey: parsed.data.CLOUDINARY_API_KEY,
    apiSecret: parsed.data.CLOUDINARY_API_SECRET,
    enabled: Boolean(parsed.data.CLOUDINARY_CLOUD_NAME && parsed.data.CLOUDINARY_API_KEY && parsed.data.CLOUDINARY_API_SECRET)
  }
} as const;
