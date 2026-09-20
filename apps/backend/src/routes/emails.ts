import { EmailStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { ensureAuthenticated } from "../middleware/auth.js";
import { emailQueue } from "../queues/emailQueue.js";
import { elasticsearch, searchEmails } from "../services/elasticsearch.js";
import { scheduleCampaign } from "../services/scheduler.js";
import { deleteAttachment } from "../services/cloudinary.js";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const scheduleSchema = z.object({
  senderEmail: z.string().email().optional(),
  recipients: z.array(z.string().email()).min(1).max(5000),
  subject: z.string().min(1).max(300),
  body: z.string().min(1),
  startTime: z.string().datetime(),
  delayBetweenEmailsMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  hourlyLimit: z.number().int().min(1).max(100000),
  attachmentIds: z.array(z.string().uuid()).max(5).optional().default([])
});

function serializeEmail(email: {
  id: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledFor: Date;
  status: EmailStatus;
  sentAt: Date | null;
  lastError: string | null;
  etherealPreviewUrl: string | null;
  campaign?: { attachments?: { id: string; fileName: string; fileType: string; fileSize: number; cloudinaryUrl: string }[] } | null;
}) {
  const attachments = email.campaign?.attachments ?? [];
  return {
    id: email.id,
    senderEmail: email.senderEmail,
    recipientEmail: email.recipientEmail,
    subject: email.subject,
    body: email.body,
    scheduledFor: email.scheduledFor.toISOString(),
    status: email.status,
    sentAt: email.sentAt?.toISOString() ?? null,
    lastError: email.lastError,
    etherealPreviewUrl: email.etherealPreviewUrl,
    attachments: attachments.map(a => ({
      id: a.id,
      fileName: a.fileName,
      fileType: a.fileType,
      fileSize: a.fileSize,
      cloudinaryUrl: a.cloudinaryUrl
    })),
    attachmentCount: attachments.length
  };
}

export const emailsRouter = Router();

emailsRouter.use(ensureAuthenticated);

const scheduledStatuses: EmailStatus[] = [EmailStatus.SCHEDULED, EmailStatus.RATE_LIMITED, EmailStatus.SENDING];

emailsRouter.post("/schedule", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const parsed = scheduleSchema.parse(req.body);
    const recipients = Array.from(
      new Set(parsed.recipients.map((email) => email.trim().toLowerCase()).filter((email) => emailRegex.test(email)))
    );

    const campaign = await scheduleCampaign(userId, {
      ...parsed,
      senderEmail: req.user!.email,
      recipients,
      startTime: new Date(parsed.startTime)
    });

    res.status(201).json({
      campaignId: campaign.id,
      scheduledCount: campaign.emails.length,
      emails: campaign.emails.map(serializeEmail)
    });
  } catch (error) {
    next(error);
  }
});

emailsRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const status = String(req.query.status ?? "scheduled");
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    // "all" returns all statuses without filtering
    const buildWhere = () => {
      if (status === "all") return { userId };
      if (status === "sent") return { userId, status: EmailStatus.SENT };
      if (status === "failed") return { userId, status: EmailStatus.FAILED };
      return { userId, status: { in: scheduledStatuses } };
    };

    const orderBy = status === "all" || status === "sent"
      ? [{ scheduledFor: "desc" as const }]
      : [{ scheduledFor: "asc" as const }];

    if (q) {
      try {
        const results = await searchEmails(userId, q);
        const filtered = results.filter((email) => {
          if (status === "all") return true;
          if (status === "sent") return email.status === EmailStatus.SENT;
          if (status === "failed") return email.status === EmailStatus.FAILED;
          return scheduledStatuses.includes(email.status);
        });
        return res.json({ emails: filtered.map(serializeEmail) });
      } catch (error) {
        console.warn("Elasticsearch search failed, falling back to database query", error);
        const emails = await prisma.emailMessage.findMany({
          where: {
            ...buildWhere(),
            OR: [
              { recipientEmail: { contains: q, mode: "insensitive" } },
              { senderEmail: { contains: q, mode: "insensitive" } },
              { subject: { contains: q, mode: "insensitive" } },
              { body: { contains: q, mode: "insensitive" } }
            ]
          },
          include: { campaign: { include: { attachments: true } } },
          orderBy,
          take: 250
        });
        return res.json({ emails: emails.map(serializeEmail) });
      }
    }

    const emails = await prisma.emailMessage.findMany({
      where: buildWhere(),
      include: { campaign: { include: { attachments: true } } },
      orderBy,
      take: 250
    });

    res.json({ emails: emails.map(serializeEmail) });
  } catch (error) {
    next(error);
  }
});

emailsRouter.delete("/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const email = await prisma.emailMessage.findFirst({
      where: { id, userId },
      include: { attachments: true }
    });

    if (!email) {
      return res.status(404).json({ error: "Email not found" });
    }

    // cancel queued bullmq job if unsent
    if (email.bullJobId && email.status !== EmailStatus.SENT) {
      try {
        const job = await emailQueue.getJob(email.bullJobId);
        if (job) await job.remove();
      } catch (queueError) {
        console.warn(`Could not cancel job ${email.bullJobId}`, queueError);
      }
    }

    if (email.attachments && email.attachments.length > 0) {
      for (const attachment of email.attachments) {
        await deleteAttachment(attachment.cloudinaryId);
      }
    }

    await prisma.emailMessage.delete({
      where: { id }
    });

    try {
      await elasticsearch.delete({
        index: "reachinbox-emails",
        id
      });
    } catch {
      // best-effort ES cleanup
    }

    res.json({ ok: true, id });
  } catch (error) {
    next(error);
  }
});
