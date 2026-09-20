import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { config } from "./config/env.js";
import { prisma } from "./db/prisma.js";

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, avatarUrl: true }
    });
    done(null, user ?? false);
  } catch (error) {
    done(error);
  }
});

if (config.google.enabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: config.google.callbackUrl
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("Google profile did not include an email"));
          }

          const user = await prisma.user.upsert({
            where: { email },
            update: {
              googleId: profile.id,
              name: profile.displayName || email,
              avatarUrl: profile.photos?.[0]?.value
            },
            create: {
              googleId: profile.id,
              email,
              name: profile.displayName || email,
              avatarUrl: profile.photos?.[0]?.value
            },
            select: { id: true, email: true, name: true, avatarUrl: true }
          });

          return done(null, user);
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );
}

export { passport };
