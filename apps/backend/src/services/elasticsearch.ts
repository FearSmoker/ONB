import { Client } from "@elastic/elasticsearch";
import type { EmailMessage } from "@prisma/client";
import { config } from "../config/env.js";
import { prisma } from "../db/prisma.js";

const EMAIL_INDEX = "reachinbox-emails";

export const elasticsearch = new Client({
  node: config.elasticsearchUrl,
  ...(config.elasticsearchApiKey ? { auth: { apiKey: config.elasticsearchApiKey } } : {}),
  tls: config.elasticsearchUrl.startsWith("https") ? { rejectUnauthorized: false } : undefined
});

export async function ensureEmailIndex() {
  try {
    const exists = await elasticsearch.indices.exists({ index: EMAIL_INDEX });
    if (exists) return;

    await elasticsearch.indices.create({
      index: EMAIL_INDEX,
      mappings: {
        properties: {
          id: { type: "keyword" },
          userId: { type: "keyword" },
          status: { type: "keyword" },
          senderEmail: {
            type: "text",
            fields: { raw: { type: "keyword" } }
          },
          recipientEmail: {
            type: "text",
            fields: { raw: { type: "keyword" } }
          },
          subject: { type: "text" },
          body: { type: "text" },
          scheduledFor: { type: "date" },
          sentAt: { type: "date" },
          createdAt: { type: "date" }
        }
      }
    });
  } catch (error: any) {
    const msg = error?.message || `HTTP ${error?.meta?.statusCode ?? "?"} – credentials missing or service unavailable`;
    console.warn(`Elasticsearch index setup skipped (${msg})`);
  }
}

export function toEmailDocument(email: EmailMessage) {
  return {
    id: email.id,
    userId: email.userId,
    status: email.status,
    senderEmail: email.senderEmail,
    recipientEmail: email.recipientEmail,
    subject: email.subject,
    body: email.body,
    scheduledFor: email.scheduledFor.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    createdAt: email.createdAt.toISOString()
  };
}

export async function indexEmail(email: EmailMessage) {
  try {
    await elasticsearch.index({
      index: EMAIL_INDEX,
      id: email.id,
      document: toEmailDocument(email)
    });
  } catch (error: any) {
    const msg = error?.message || `HTTP ${error?.meta?.statusCode ?? "?"}`;
    console.warn(`Elasticsearch indexing skipped for ${email.id} (${msg})`);
  }
}

export async function indexEmailById(emailId: string) {
  try {
    const email = await prisma.emailMessage.findUnique({ where: { id: emailId } });
    if (!email) return;
    await indexEmail(email);
  } catch (error: any) {
    const msg = error?.message || `HTTP ${error?.meta?.statusCode ?? "?"}`;
    console.warn(`Elasticsearch indexing skipped for ${emailId} (${msg})`);
  }
}

export async function searchEmails(userId: string, query: string) {
  const response = await elasticsearch.search<{ id: string }>({
    index: EMAIL_INDEX,
    size: 100,
    query: {
      bool: {
        filter: [{ term: { userId } }],
        must: [
          {
            simple_query_string: {
              query,
              fields: ["recipientEmail^3", "senderEmail^2", "subject^3", "body"],
              default_operator: "and"
            }
          }
        ]
      }
    }
  });

  const ids = response.hits.hits.map((hit) => hit._id).filter(Boolean) as string[];
  if (ids.length === 0) return [];

  const emails = await prisma.emailMessage.findMany({
    where: { id: { in: ids }, userId },
    include: { campaign: { include: { attachments: true } } },
    orderBy: [{ scheduledFor: "desc" }]
  });

  const byId = new Map(emails.map((email) => [email.id, email]));
  return ids
    .map((id) => byId.get(id))
    .filter((email): email is (typeof emails)[number] => Boolean(email));
}
