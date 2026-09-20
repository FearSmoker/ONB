import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { ensureAuthenticated } from "../middleware/auth.js";
import { buildSlackAuthorizeUrl, exchangeSlackCode } from "../services/slack.js";

export const slackRouter = Router();

slackRouter.get("/status", ensureAuthenticated, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      slackIncomingWebhookUrl: true,
      slackTeamName: true,
      slackChannelName: true
    }
  });

  res.json({
    connected: Boolean(user?.slackIncomingWebhookUrl),
    teamName: user?.slackTeamName ?? null,
    channelName: user?.slackChannelName ?? null
  });
});

slackRouter.get("/connect", ensureAuthenticated, (req, res) => {
  if (!config.slack.enabled) {
    return res.status(503).json({
      error: "Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET."
    });
  }

  const state = crypto.randomBytes(18).toString("hex");
  req.session.slackOAuthState = state;
  res.redirect(buildSlackAuthorizeUrl(state));
});

slackRouter.get("/callback", ensureAuthenticated, async (req, res, next) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code || !state || state !== req.session.slackOAuthState) {
      return res.status(400).json({ error: "Invalid Slack OAuth callback" });
    }

    const response = await exchangeSlackCode(code);
    if (!response.ok || !response.access_token || !response.incoming_webhook?.url) {
      return res.status(400).json({
        error: response.error ?? "Slack did not return an incoming webhook"
      });
    }

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        slackAccessToken: response.access_token,
        slackIncomingWebhookUrl: response.incoming_webhook.url,
        slackTeamId: response.team?.id,
        slackTeamName: response.team?.name,
        slackChannelId: response.incoming_webhook.channel_id,
        slackChannelName: response.incoming_webhook.channel
      }
    });

    req.session.slackOAuthState = undefined;
    res.redirect(config.frontendUrl);
  } catch (error) {
    next(error);
  }
});

slackRouter.post("/disconnect", ensureAuthenticated, async (req, res) => {
  await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      slackAccessToken: null,
      slackIncomingWebhookUrl: null,
      slackTeamId: null,
      slackTeamName: null,
      slackChannelId: null,
      slackChannelName: null
    }
  });

  res.json({ ok: true });
});
