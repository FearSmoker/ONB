import { config } from "../config/env.js";
import { prisma } from "../db/prisma.js";

type SlackOAuthResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: {
    url?: string;
    channel?: string;
    channel_id?: string;
  };
};

export function buildSlackAuthorizeUrl(state: string) {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", config.slack.clientId);
  url.searchParams.set("scope", "chat:write,incoming-webhook");
  url.searchParams.set("redirect_uri", config.slack.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeSlackCode(code: string): Promise<SlackOAuthResponse> {
  const body = new URLSearchParams({
    client_id: config.slack.clientId,
    client_secret: config.slack.clientSecret,
    code,
    redirect_uri: config.slack.redirectUri
  });

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  return (await response.json()) as SlackOAuthResponse;
}

export async function notifyRateLimit(input: {
  userId: string;
  senderEmail: string;
  hourlyLimit: number;
  retryAt: Date;
}) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user?.slackIncomingWebhookUrl) return;

  const text = [
    `ReachInbox scheduler paused ${input.senderEmail}.`,
    `Hourly limit (${input.hourlyLimit}) was reached.`,
    `Next attempt: ${input.retryAt.toISOString()}.`
  ].join(" ");

  await fetch(user.slackIncomingWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
}
