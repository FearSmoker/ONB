import type { User as DbUser } from "@prisma/client";

declare global {
  namespace Express {
    interface User extends Pick<DbUser, "id" | "email" | "name" | "avatarUrl"> {}
  }
}

declare module "express-session" {
  interface SessionData {
    slackOAuthState?: string;
  }
}

export {};
