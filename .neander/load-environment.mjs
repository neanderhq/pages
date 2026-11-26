import { readFileSync } from "node:fs";

const required = ["DATABASE_URL", "APP_URL", "BETTER_AUTH_SECRET"];
const allowed = new Set([...required, "DEMO_PASSWORD", "EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"]);
const seen = new Set();
for (const line of readFileSync("/run/secrets/neander_environment", "utf8").split("\n")) {
  if (!line) continue;
  const separator = line.indexOf("=");
  const name = line.slice(0, separator), value = line.slice(separator + 1);
  if (separator < 1 || !allowed.has(name) || seen.has(name) || /[\r\x00]/.test(value)) {
    throw new Error("Invalid managed environment bundle.");
  }
  seen.add(name);
  process.env[name] = value;
}
if (required.some(name => !seen.has(name) || !process.env[name])) throw new Error("Missing managed environment input.");
