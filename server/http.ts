// Small HTTP helpers shared by the Step 1 routes in app.ts and the Step 2 page routes in pages.ts.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const fail = (status: number, message: string): never => { throw new HttpError(status, message); };
export const json = (value: unknown, status = 200) => Response.json(value, { status });
export function field(body: Record<string, unknown>, key: string, min = 1, max = 100) {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) return fail(400, `${key} must be ${min}–${max} characters.`);
  return value.trim();
}
export async function bodyOf(request: Request, limit = 16_384): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > limit) fail(413, "Request is too large.");
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Expected a JSON object.");
    return value as Record<string, unknown>;
  } catch { return fail(400, "Enter valid form data."); }
}
