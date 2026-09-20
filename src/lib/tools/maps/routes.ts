import { assertToolAllowed } from "@/lib/agents/registry";

export type RouteEstimate = { durationMinutes: number; distanceMeters: number };

export async function calculateDrivingRoute(origin: string, destination: string): Promise<RouteEstimate> {
  assertToolAllowed("calendar", "routes.calculate");
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY!, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters" },
    body: JSON.stringify({ origin: { address: origin }, destination: { address: destination }, travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", computeAlternativeRoutes: false, languageCode: "en-US", units: "IMPERIAL" }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`GOOGLE_ROUTES_${response.status}`);
  const body = await response.json() as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
  const route = body.routes?.[0];
  if (!route?.duration) throw new Error("GOOGLE_ROUTES_EMPTY");
  return { durationMinutes: Math.ceil(Number(route.duration.replace("s", "")) / 60), distanceMeters: route.distanceMeters ?? 0 };
}
