import { EmailStatus } from "@prisma/client";
import { config } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { emailQueue } from "../queues/emailQueue.js";
import { indexEmail } from "./elasticsearch.js";

export type ScheduleEmailInput = {
  senderEmail: string;
  recipients: string[];
  subject: string;
  body: string;
  startTime: Date;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  attachmentIds?: string[];
  senderEmails?: string[];
};

export async function enqueueEmail(emailId: string, scheduledFor: Date) {
  const delay = Math.max(scheduledFor.getTime() - Date.now(), 0);
  const jobId = `email_${emailId}_${scheduledFor.getTime()}_${Date.now()}`;
  const job = await emailQueue.add("send-email", { emailId }, { delay, jobId });

  await prisma.emailMessage.update({
    where: { id: emailId },
    data: { bullJobId: job.id }
  });

  return job;
}

export async function scheduleCampaign(userId: string, input: ScheduleEmailInput) {
  const delayBetweenEmailsMs = Math.max(0, input.delayBetweenEmailsMs);
  const hourlyLimit = Math.max(1, input.hourlyLimit || config.queue.maxEmailsPerHourPerSender);
  const sender = input.senderEmail;

  const emailsData = input.recipients.map((recipientEmail, index) => ({
    userId,
    senderEmail: sender,
    recipientEmail,
    subject: input.subject,
    body: input.body,
    scheduledFor: new Date(input.startTime.getTime() + index * delayBetweenEmailsMs),
    delayBetweenEmailsMs,
    hourlyLimit
  }));

  const campaign = await prisma.emailCampaign.create({
    data: {
      userId,
      senderEmail: sender,
      subject: input.subject,
      body: input.body,
      startTime: input.startTime,
      delayBetweenEmailsMs,
      hourlyLimit,
      totalRecipients: emailsData.length,
      emails: {
        create: emailsData
      }
    },
    include: { emails: true }
  });

  if (input.attachmentIds && input.attachmentIds.length > 0) {
    await prisma.attachment.updateMany({
      where: { id: { in: input.attachmentIds } },
      data: { campaignId: campaign.id }
    });
  }

  for (const email of campaign.emails) {
    await enqueueEmail(email.id, email.scheduledFor);
    try {
      await indexEmail(email);
    } catch (error) {
      console.warn(`Elasticsearch indexing failed for email ${email.id} during campaign creation`, error);
    }
  }

  const updatedCampaign = await prisma.emailCampaign.findUnique({
    where: { id: campaign.id },
    include: { emails: true }
  });

  return updatedCampaign ?? campaign;
}

export async function rescheduleEmail(
  emailId: string,
  retryAt: Date,
  reason: string,
  status: EmailStatus = EmailStatus.RATE_LIMITED
) {
  const email = await prisma.emailMessage.update({
    where: { id: emailId },
    data: {
      status,
      scheduledFor: retryAt,
      lastError: status === EmailStatus.RATE_LIMITED ? reason : null
    }
  });

  await enqueueEmail(email.id, retryAt);
  try {
    await indexEmail(email);
  } catch (error) {
    console.warn(`Elasticsearch indexing failed for rescheduled email ${email.id}`, error);
  }
  return email;
}
