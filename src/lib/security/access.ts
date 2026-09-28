/** Private deployment: an explicit immutable Supabase user ID allowlist is required in production. */
export function allowedUser(userId: string) {
  const ids = (process.env.DAYLARK_ALLOWED_USER_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  return ids.length ? ids.includes(userId) : process.env.NODE_ENV !== "production";
}

export async function boundedJson(request: Request, limit = 8192) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("INVALID_REQUEST");
  return JSON.parse((await boundedBody(request, limit)).toString("utf8"));
}

export async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("INVALID_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error("INVALID_REQUEST"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
