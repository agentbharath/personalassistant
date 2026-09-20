import { timingSafeEqual } from "node:crypto";

export function hasValidInternalBearer(request: Request, expectedSecret = process.env.CRON_SECRET) {
  if (!expectedSecret) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice(7);
  const expected = Buffer.from(expectedSecret);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
