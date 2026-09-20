import "./tlsSetup.js";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter.js";
import { createBullBoard } from "@bull-board/api";
import { ExpressAdapter } from "@bull-board/express";
import cors from "cors";
import express from "express";
import session from "express-session";
import { ZodError } from "zod";
import { config } from "./config/env.js";
import { emailQueue } from "./queues/emailQueue.js";
import { ensureEmailIndex } from "./services/elasticsearch.js";
import { passport } from "./passport.js";
import { authRouter } from "./routes/auth.js";
import { emailsRouter } from "./routes/emails.js";
import { healthRouter } from "./routes/health.js";
import { meRouter } from "./routes/me.js";
import { slackRouter } from "./routes/slack.js";
import { attachmentsRouter } from "./routes/attachments.js";
import { UPLOADS_DIR } from "./services/cloudinary.js";
import { startWorker, stopWorker } from "./worker.js";

const app = express();

// health check route for load balancer
app.get(["/", "/health"], (_req, res) => {
  res.status(200).json({ ok: true, name: "ReachInbox Scheduler API", status: "healthy" });
});

const PgSession = connectPgSimple(session);

const cleanDbUrl = config.databaseUrl.replace(/([?&])sslmode=require(&|$)/, "$1").replace(/[?&]$/, "");
const pgPool = new pg.Pool({
  connectionString: cleanDbUrl,
  ssl: config.databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
});

app.set("trust proxy", 1);

// normalize duplicate slashes in request paths
app.use((req, _res, next) => {
  if (req.url && req.url.includes("//")) {
    req.url = req.url.replace(/\/{2,}/g, "/");
  }
  next();
});

app.use(
  cors({
    origin: [config.frontendUrl, "https://onb-ltd.netlify.app", "http://localhost:5173"].filter(Boolean),
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    store: new PgSession({
      pool: pgPool,
      createTableIfMissing: true
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: config.frontendUrl.startsWith("https") ? "none" : "lax",
      secure: config.frontendUrl.startsWith("https"),
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(emailQueue) as never],
  serverAdapter
});

app.use("/health/deep", healthRouter);
app.use(["/api/auth", "/auth/api"], authRouter);
app.use("/api/me", meRouter);
app.use("/api/emails", emailsRouter);
app.use("/api/slack", slackRouter);
app.use("/api/attachments", attachmentsRouter);

// local attachment storage fallback
app.use("/uploads", (_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  next();
}, express.static(UPLOADS_DIR, { fallthrough: false }));
// bull board dashboard for queue monitoring
app.get("/admin/queues", (req, res, next) => {
  if (!req.originalUrl.endsWith("/")) {
    return res.redirect(301, "/admin/queues/");
  }
  next();
});
app.use("/admin/queues", serverAdapter.getRouter());

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: error.flatten() });
  }

  console.error(error);
  return res.status(500).json({
    error: error instanceof Error ? error.message : "Unexpected server error"
  });
});

const server = app.listen(config.port, "0.0.0.0", () => {
  console.info(`Backend listening on 0.0.0.0:${config.port}`);
  console.info(`BullMQ dashboard available at http://localhost:${config.port}/admin/queues`);
});

// start worker and ensure search index
void ensureEmailIndex();
startWorker();

process.on("SIGTERM", async () => {
  await stopWorker();
  server.close(() => process.exit(0));
});

process.on("SIGINT", async () => {
  await stopWorker();
  server.close(() => process.exit(0));
});
