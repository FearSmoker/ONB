import "./tlsSetup.js";
import { EmailStatus } from "@prisma/client";
import { Job, Worker } from "bullmq";
import { config } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { createRedisConnection } from "./db/redis.js";
import type { SendEmailJob } from "./queues/emailQueue.js";
import { indexEmailById } from "./services/elasticsearch.js";
import { sendEmail } from "./services/mailer.js";
import { reserveSendSlot, shouldNotifyRateLimit } from "./services/rateLimiter.js";
import { rescheduleEmail } from "./services/scheduler.js";
import { notifyRateLimit } from "./services/slack.js";

export async function processEmail(job: Job<SendEmailJob>) {
  const email = await prisma.emailMessage.findUnique({
    where: { id: job.data.emailId },
    include: {
      campaign: {
        include: { attachments: true }
      }
    }
  });

  if (!email) return { skipped: "missing" };
  if (email.status === EmailStatus.SENT) return { skipped: "already_sent" };

  if (email.scheduledFor.getTime() > Date.now() + 500) {
    await rescheduleEmail(email.id, email.scheduledFor, "Waiting for scheduled send time", EmailStatus.SCHEDULED);
    return { rescheduled: email.scheduledFor.toISOString() };
  }

  const slot = await reserveSendSlot({
    userId: email.userId,
    senderEmail: email.senderEmail,
    hourlyLimit: email.hourlyLimit || config.queue.maxEmailsPerHourPerSender
  });

  if (!slot.allowed) {
    await rescheduleEmail(
      email.id,
      slot.retryAt,
      `Hourly limit reached for ${email.senderEmail}; rescheduled automatically`
    );

    const shouldNotify = await shouldNotifyRateLimit({
      userId: email.userId,
      senderEmail: email.senderEmail,
      hourStart: slot.hourStart
    });

    if (shouldNotify) {
      await notifyRateLimit({
        userId: email.userId,
        senderEmail: email.senderEmail,
        hourlyLimit: email.hourlyLimit,
        retryAt: slot.retryAt
      }).catch((error) => {
        console.warn("Slack rate-limit notification failed", error);
      });
    }

    return { rateLimitedUntil: slot.retryAt.toISOString() };
  }

  const claim = await prisma.emailMessage.updateMany({
    where: {
      id: email.id,
      status: { in: [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED, EmailStatus.FAILED] }
    },
    data: {
      status: EmailStatus.SENDING,
      attempts: { increment: 1 },
      lastError: null
    }
  });

  if (claim.count === 0) return { skipped: "not_claimable" };

  try {
    const sent = await sendEmail({
      senderEmail: email.senderEmail,
      recipientEmail: email.recipientEmail,
      subject: email.subject,
      body: email.body,
      attachments: email.campaign?.attachments?.map((a) => ({
        fileName: a.fileName,
        cloudinaryUrl: a.cloudinaryUrl
      }))
    });

    await prisma.emailMessage.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
        failedAt: null,
        etherealMessageId: sent.messageId,
        etherealPreviewUrl: sent.previewUrl
      }
    });

    // best-effort search index update
    try {
      await indexEmailById(email.id);
    } catch {
      // elasticsearch indexing is best-effort, failures are handled inside indexEmailById
    }

    return { sent: email.recipientEmail, previewUrl: sent.previewUrl };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown email send failure";

    await prisma.emailMessage.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.FAILED,
        failedAt: new Date(),
        lastError: errMsg
      }
    });

    try {
      await indexEmailById(email.id);
    } catch {
      // best-effort index sync
    }

    // record failure without triggering infinite bullmq retries
    console.error(`Email ${email.id} to ${email.recipientEmail} failed: ${errMsg}`);
    return { failed: email.recipientEmail, reason: errMsg };
  }
}

import { emailQueue } from "./queues/emailQueue.js";
import { fileURLToPath } from "node:url";

let activeWorker: Worker<SendEmailJob> | null = null;
let sweepInterval: NodeJS.Timeout | null = null;

export async function sweepOverdueEmails() {
  try {
    // recover stale sending records after process crash
    await prisma.emailMessage.updateMany({
      where: {
        status: EmailStatus.SENDING,
        updatedAt: { lte: new Date(Date.now() - 5 * 60 * 1000) }
      },
      data: {
        status: EmailStatus.SCHEDULED
      }
    });

    const overdue = await prisma.emailMessage.findMany({
      where: {
        status: EmailStatus.SCHEDULED,
        scheduledFor: { lte: new Date() }
      },
      take: 25
    });

    for (const email of overdue) {
      const jobId = `sweep_${email.id}_${Date.now()}`;
      await emailQueue.add("send-email", { emailId: email.id }, { delay: 0, jobId });
    }
  } catch (error) {
    console.warn("Error sweeping overdue emails", error);
  }
}

export function startWorker() {
  if (activeWorker) return activeWorker;

  activeWorker = new Worker<SendEmailJob>(config.queue.name, processEmail, {
    connection: createRedisConnection(),
    concurrency: config.queue.workerConcurrency,
    limiter: {
      max: 1,
      duration: config.queue.minSendIntervalMs
    }
  });

  activeWorker.on("completed", (job) => {
    console.info(`Email job ${job.id} completed`);
  });

  activeWorker.on("failed", (job, error) => {
    console.error(`Email job ${job?.id ?? "unknown"} failed`, error);
  });

  // periodic sweeper checks for overdue scheduled emails every 10s
  sweepInterval = setInterval(() => {
    void sweepOverdueEmails();
  }, 10000);

  // run initial sweep on startup
  void sweepOverdueEmails();

  return activeWorker;
}

export async function stopWorker() {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
  if (activeWorker) {
    await activeWorker.close();
    activeWorker = null;
  }
}

process.on("SIGTERM", async () => {
  await stopWorker();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await stopWorker();
  process.exit(0);
});

// start automatically if invoked directly
const isDirectCli = process.argv[1] && (
  process.argv[1].endsWith("worker.ts") || 
  process.argv[1].endsWith("worker.js")
);

if (isDirectCli) {
  startWorker();
  console.info(
    `Email worker running with concurrency=${config.queue.workerConcurrency}, minSendIntervalMs=${config.queue.minSendIntervalMs}`
  );
}
