import { z } from "zod";
import { GeocodingUnavailableError, reverseGeocode } from "@/lib/tools/maps/geocode";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

/** One-time lookup of the city for the coordinates the browser gave, used by "Use my current location" in Settings. Nothing is stored. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims?.sub !== "string") return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  try {
    const place = await reverseGeocode(body.data.latitude, body.data.longitude);
    return place ? Response.json({ place }) : Response.json({ error: "NO_PLACE_FOUND" }, { status: 404 });
  } catch (failure) {
    const unavailable = failure instanceof GeocodingUnavailableError;
    return Response.json({ error: unavailable ? "GEOCODING_UNAVAILABLE" : "LOOKUP_FAILED" }, { status: unavailable ? 503 : 502 });
  }
}
