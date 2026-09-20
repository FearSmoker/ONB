import { Router } from "express";
import { config } from "../config/env.js";
import { passport } from "../passport.js";
import { prisma } from "../db/prisma.js";

export const authRouter = Router();

authRouter.get("/google", (req, res, next) => {
  if (!config.google.enabled) {
    return res.status(503).json({
      error: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
    });
  }

  return passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account"
  })(req, res, next);
});

authRouter.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/api/auth/failure"
  }),
  (_req, res) => {
    res.redirect(config.frontendUrl);
  }
);

authRouter.get("/failure", (_req, res) => {
  res.redirect(`${config.frontendUrl}?error=Google%20authentication%20failed`);
});

authRouter.post("/login", async (req, res, next) => {
  const { email, password } = req.body ?? {};
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }
  if (!password || typeof password !== "string" || password.trim().length === 0) {
    return res.status(400).json({ error: "Password is required" });
  }

  try {
    const cleanEmail = email.toLowerCase().trim();
    const defaultAvatar = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=128&h=128&q=80";
    const formattedName = cleanEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const user = await prisma.user.upsert({
      where: { email: cleanEmail },
      update: {},
      create: {
        email: cleanEmail,
        name: formattedName,
        avatarUrl: defaultAvatar
      },
      select: { id: true, email: true, name: true, avatarUrl: true }
    });

    req.login(user, (error) => {
      if (error) return next(error);
      return res.json({ user });
    });
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/logout", (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

