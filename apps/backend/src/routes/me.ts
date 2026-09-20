import { Router } from "express";
import multer from "multer";
import { prisma } from "../db/prisma.js";
import { ensureAuthenticated } from "../middleware/auth.js";
import { uploadAttachment } from "../services/cloudinary.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const DEFAULT_AVATAR = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=128&h=128&q=80";

export const meRouter = Router();

meRouter.get("/", ensureAuthenticated, async (req, res) => {
  let user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      slackIncomingWebhookUrl: true,
      slackTeamName: true,
      slackChannelName: true
    }
  });

  // backfill default avatar if missing
  if (user && !user.avatarUrl) {
    try {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: DEFAULT_AVATAR },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          slackIncomingWebhookUrl: true,
          slackTeamName: true,
          slackChannelName: true
        }
      });
    } catch {
      // noop
    }
  }

  res.json({
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl ?? DEFAULT_AVATAR,
          slackConnected: Boolean(user.slackIncomingWebhookUrl),
          slackTeamName: user.slackTeamName,
          slackChannelName: user.slackChannelName
        }
      : null
  });
});

meRouter.post("/avatar", ensureAuthenticated, upload.single("avatar"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No avatar file uploaded" });
    }

    const { url } = await uploadAttachment(req.file.buffer, req.file.originalname);
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarUrl: url },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        slackIncomingWebhookUrl: true,
        slackTeamName: true,
        slackChannelName: true
      }
    });

    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        avatarUrl: updated.avatarUrl,
        slackConnected: Boolean(updated.slackIncomingWebhookUrl),
        slackTeamName: updated.slackTeamName,
        slackChannelName: updated.slackChannelName
      }
    });
  } catch (error) {
    next(error);
  }
});
