export type Mail = {
  to: string;
  kind: "invitation" | "password-reset" | "mention" | "review-reminder";
  url: string;
  company?: string;
  pageTitle?: string;
  idempotencyKey?: string;
};
export interface MailProvider {
  kind: "console" | "delivery" | "test" | "unavailable";
  send(message: Mail): Promise<void>;
}

export class MailDeliveryError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export class MailUnavailableError extends MailDeliveryError {
  constructor(message = "Email delivery is unavailable. Configure EMAIL_PROVIDER=resend, RESEND_API_KEY, and EMAIL_FROM.") {
    super(message, 503);
  }
}

export function createMailProvider(environment: string, configured?: MailProvider): MailProvider {
  if (environment === "production") return configured?.kind === "delivery" || configured?.kind === "unavailable" ? configured : unavailableMailProvider(undefined, "unset");
  if (configured) return configured;
  return {
    kind: "console",
    async send(message) {
      console.info(`\n[Development email: ${message.kind}]\nTo: ${message.to}\n${message.company ? `Workspace: ${message.company}\n` : ""}${message.url}\n`);
    },
  };
}

export function createMailProviderFromEnvironment(environment: string, settings: NodeJS.ProcessEnv = process.env): MailProvider {
  const provider = settings.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!provider) return environment === "production" ? unavailableMailProvider(undefined, "unset") : createMailProvider(environment);
  if (provider === "console") return environment === "production" ? unavailableMailProvider(undefined, "console") : createMailProvider(environment);
  if (provider === "resend") {
    if (!settings.RESEND_API_KEY?.trim() || !settings.EMAIL_FROM?.trim()) return unavailableMailProvider(undefined, "resend");
    try { return createResendMailProvider(settings.RESEND_API_KEY.trim(), settings.EMAIL_FROM.trim()); }
    catch (error) { return unavailableMailProvider(error instanceof Error ? error.message : undefined); }
  }
  if (provider === "disabled" || provider === "none") return unavailableMailProvider("Email delivery is disabled. Set EMAIL_PROVIDER=resend, RESEND_API_KEY, and EMAIL_FROM to enable it.");
  return unavailableMailProvider("Email delivery is unavailable. EMAIL_PROVIDER must be resend or console.");
}

function unavailableMailProvider(message?: string, warningMode?: string): MailProvider {
  return {
    kind: "unavailable",
    async send(mail) {
      if (warningMode) console.warn("Email delivery unavailable; no message was sent.", { provider: warningMode, kind: mail.kind });
      throw new MailUnavailableError(message);
    },
  };
}

function contentFor(message: Mail) {
  if (message.kind === "invitation") return { subject: `You’re invited to ${message.company ?? "Pages"}`, text: `You have been invited to ${message.company ?? "a Pages workspace"}. Accept the invitation: ${message.url}` };
  if (message.kind === "password-reset") return { subject: "Reset your Pages password", text: `Use this link to reset your password: ${message.url}` };
  if (message.kind === "mention") return { subject: `You were mentioned on ${message.pageTitle ?? "a page"}`, text: `You were mentioned on “${message.pageTitle ?? "a page"}”${message.company ? ` in ${message.company}` : ""}. View it here: ${message.url}` };
  return { subject: `A page is due for review: ${message.pageTitle ?? "Untitled"}`, text: `The page “${message.pageTitle ?? "Untitled"}”${message.company ? ` in ${message.company}` : ""} is due for review. Open it here: ${message.url}` };
}

export function createResendMailProvider(apiKey: string, from: string, fetcher: typeof fetch = fetch): MailProvider {
  if (!apiKey.trim() || !from.trim() || /[\r\n]/.test(from)) throw new MailUnavailableError();
  const token = apiKey.trim(), sender = from.trim();
  return {
    kind: "delivery",
    async send(message) {
      const content = contentFor(message);
      let response: Response;
      try {
        response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}) },
          body: JSON.stringify({ from: sender, to: [message.to], ...content }),
        });
      } catch {
        throw new MailDeliveryError("Email could not be delivered. Check the provider connection and retry.");
      }
      if (!response.ok) throw new MailDeliveryError(`Email could not be delivered (provider returned HTTP ${response.status}).`);
    },
  };
}
