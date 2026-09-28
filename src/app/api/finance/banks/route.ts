import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { bankErrorMessage, plaidConfig, PlaidError } from "@/lib/plaid/client";
import { bankOverview, completeBankLink, createBankLink, disconnectBank, importBankRecord, syncBank } from "@/lib/plaid/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), connectionId: z.string().uuid().optional() }),
  z.object({ action: z.literal("exchange"), sessionId: z.string().uuid(), publicToken: z.string().min(1).max(500).optional() }),
  z.object({ action: z.literal("sync"), connectionId: z.string().uuid() }),
  z.object({ action: z.literal("disconnect"), connectionId: z.string().uuid() }),
  z.object({ action: z.literal("import"), id: z.string().uuid(), hash: z.string().min(1).max(128), matchId: z.string().uuid().optional(), keepSynced: z.literal(true) }),
]);
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
async function actor() {
  const { data, error } = await (await createClient()).auth.getClaims();
  return !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
}
export async function GET(request: Request) {
  const userId = await actor();
  if (!userId) return reply({ error: "Sign in to see bank connections." }, 401);
  try {
    plaidConfig();
    const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return reply({ error: "Invalid page." }, 400);
    return reply(await bankOverview(userId, offset));
  } catch (error) { return reply({ error: bankErrorMessage(error) }, 503); }
}
export async function POST(request: Request) {
  const userId = await actor();
  if (!userId) return reply({ error: "Sign in to manage bank connections." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "Invalid request origin." }, 403);
  const input = actions.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: "Invalid bank request." }, 400);
  try {
    const config = plaidConfig();
    const action = input.data;
    if (action.action === "link") return reply(await createBankLink(userId, action.connectionId));
    if (action.action === "exchange") return reply({ connectionId: await completeBankLink(userId, action.sessionId, action.publicToken) });
    if (action.action === "sync") return reply(await syncBank(userId, action.connectionId));
    if (action.action === "disconnect") { await disconnectBank(userId, action.connectionId); return reply({ message: "Bank disconnected. Previously saved transactions remain." }); }
    if (config.environment !== "production") throw new PlaidError("SANDBOX_IMPORT_DISABLED");
    await importBankRecord(userId, action.id, action.hash, action.matchId);
    return reply({ message: "Saved to Daylark. Future bank corrections will stay in sync." });
  } catch (error) { return reply({ error: bankErrorMessage(error) }, error instanceof PlaidError && error.code === "BANK_BUSY" ? 409 : 503); }
}
