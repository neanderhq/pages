import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "drizzle-orm";
import * as schema from "./schema.ts";
import type { Database, Transaction } from "./database.ts";
import type { MailProvider } from "./mail.ts";

export function createAuth(db: Database | Transaction, options: { origin: string; secret: string; mail: MailProvider; production: boolean }) {
  return betterAuth({
    appName: "Pages", baseURL: options.origin, secret: options.secret, trustedOrigins: [options.origin],
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: false }),
    emailAndPassword: {
      enabled: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800, revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }) {
        await options.mail.send({ to: user.email, kind: "password-reset", url: `${options.origin}/reset-password#token=${encodeURIComponent(token)}` });
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: options.production, defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } },
    rateLimit: { enabled: false },
    databaseHooks: {
      session: { create: { async before(value) {
        const [membership] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.userId, value.userId), eq(schema.memberships.status, "active"))).limit(1);
        if (!membership) throw new APIError("FORBIDDEN", { message: "Your workspace access has been deactivated. Contact an administrator." });
        return { data: value };
      } } },
    },
  });
}
