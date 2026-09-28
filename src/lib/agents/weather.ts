import { Temporal } from "@js-temporal/polyfill";
import { embedCard, type WeatherCardPayload } from "@/lib/chat/card-payload";
import { conditionFor, fetchForecast, geocodeLocation, FOG_CODES, RAIN_CODES, type Forecast } from "@/lib/tools/weather/open-meteo";
import { answerPublicSearch } from "./general";
import { TIME_UNAVAILABLE } from "./time-interpreter";
import { askAboutTime } from "./calendar";
import { interpretTimeForUser } from "./time-interpreter-runtime";

const DEFAULT_TIME_ZONE = process.env.DEFAULT_USER_TIMEZONE ?? "America/Los_Angeles";
const HIGH_CHANCE = 50; // precipitation_probability (%) at or above this counts as "it will rain/snow" for a yes/no question
const HOURLY_POINTS = 6; // matches the mockup's own hourly strip length in every example

const round = (value: number) => Math.round(value);
const clockLabel = (localTime: string) => {
  const [, hm] = localTime.split("T");
  const [h, m] = hm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${h < 12 ? " AM" : " PM"}` : `${hour}:${String(m).padStart(2, "0")}${h < 12 ? " AM" : " PM"}`;
};
const shortHour = (localTime: string) => {
  const [, hm] = localTime.split("T");
  const [h] = hm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${h < 12 ? "AM" : "PM"}`;
};

/** hourly.time entries are local ("YYYY-MM-DDTHH:mm", no offset, from the forecast's own IANA timezone param) --
 * compared as instants so the lookup never depends on exactly matching that string format. */
function hourlyInstants(hourly: Forecast["hourly"], timeZone: string): string[] {
  return hourly.time.map((local) => Temporal.PlainDateTime.from(local).toZonedDateTime(timeZone).toInstant().toString());
}

/** Evenly sampled indices across a range, capped to `count` points -- the mockup's own hourly strips are always a handful of points, not one per hour of a long window. */
function sampleIndices(indices: number[], count: number): number[] {
  if (indices.length <= count) return indices;
  return Array.from({ length: count }, (_, i) => indices[Math.round((i * (indices.length - 1)) / (count - 1))]);
}

function dominantCondition(codes: number[]): number {
  // The most severe code wins (higher WMO codes are broadly more severe/eventful) -- "partly cloudy all day, rain at 5" should read as rain, not cloudy.
  return codes.length ? Math.max(...codes) : 0;
}

/** The contiguous stretch of high precipitation-chance hours, for a "Rain, 2 to 7 PM" style condition label and the
 * yes/no eyebrow's own rain-vs-snow word -- both read off the SAME hours (only ones that actually cross
 * HIGH_CHANCE), so a dry day never gets called "chance of snow" just because its one non-rain code wasn't a rain
 * code either (found live: a clear October day in Sunnyvale came back "chance of snow"). Null when nothing does. */
function rainAssessment(hourly: Forecast["hourly"], indices: number[]): { kind: "rain" | "snow"; label: string; peakIndex: number } | null {
  const rainy = indices.filter((i) => hourly.precipitationProbability[i] >= HIGH_CHANCE);
  if (!rainy.length) return null;
  const kind = RAIN_CODES.has(dominantCondition(rainy.map((i) => hourly.weatherCode[i]))) ? "rain" : "snow";
  const label = rainy.length === 1 ? `${kind === "rain" ? "Rain" : "Snow"}, ${clockLabel(hourly.time[rainy[0]])}` : `${kind === "rain" ? "Rain" : "Snow"}, ${clockLabel(hourly.time[rainy[0]])} to ${clockLabel(hourly.time[rainy[rainy.length - 1]])}`;
  const peakIndex = rainy.slice().sort((a, b) => hourly.precipitationProbability[b] - hourly.precipitationProbability[a])[0];
  return { kind, label, peakIndex };
}

const windLabel = (mph: number, direction: number) => `${round(mph)} mph ${["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(direction / 22.5) % 16]}`;
const uvLabel = (uv: number) => `${round(uv)} · ${uv >= 8 ? "Very High" : uv >= 6 ? "High" : uv >= 3 ? "Moderate" : "Low"}`;

type BuildInput = { forecast: Forecast; placeName: string; timeZone: string; window: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime; label: string }; yesNo: boolean; now: string };

/** Everything the card needs, computed once from the forecast + the resolved time window. No model in the loop --
 * every number and word comes straight from the API response, the same reasoning R32 already applied to places and fares. */
function buildWeatherCard({ forecast, placeName, timeZone, window, yesNo, now }: BuildInput): WeatherCardPayload {
  const instants = hourlyInstants(forecast.hourly, timeZone);
  const windowStart = window.start.toInstant().toString();
  const windowEnd = window.end.toInstant().toString();
  const inWindow = instants.map((t, i) => i).filter((i) => instants[i] >= windowStart && instants[i] < windowEnd);
  const dayKey = window.start.toPlainDate().toString();
  const dayIndex = Math.max(0, forecast.daily.time.indexOf(dayKey));

  const includesNow = windowStart <= now && now < windowEnd && dayIndex === 0;
  const isTonight = /tonight|evening/i.test(window.label) && window.start.hour >= 17;
  const isFogQuestion = inWindow.some((i) => FOG_CODES.has(forecast.hourly.weatherCode[i]));

  const dayWord = includesNow ? "Now" : isTonight ? "Tonight" : window.start.toLocaleString("en-US", { weekday: "long" });
  const sampled = sampleIndices(inWindow.length ? inWindow : [0], HOURLY_POINTS);

  if (yesNo) {
    const assessment = rainAssessment(forecast.hourly, inWindow.length ? inWindow : [dayIndex]);
    return {
      kind: "weather", eyebrow: `${dayWord} · ${assessment ? `chance of ${assessment.kind}` : "clear skies expected"}`,
      headline: assessment ? "Yes" : "No", condition: assessment?.label ?? conditionFor(dominantCondition(inWindow.map((i) => forecast.hourly.weatherCode[i]))),
      insight: assessment ? `Showers ${window.label}, heaviest around ${clockLabel(forecast.hourly.time[assessment.peakIndex])}.` : `No rain expected ${window.label}.`,
      rangeLow: round(Math.min(...inWindow.map((i) => forecast.hourly.temperature[i]))), rangeHigh: round(Math.max(...inWindow.map((i) => forecast.hourly.temperature[i]))),
      current: round(forecast.hourly.temperature[inWindow[0] ?? dayIndex]),
      hourly: sampled.map((i) => ({ label: shortHour(forecast.hourly.time[i]), value: round(forecast.hourly.precipitationProbability[i]), highlighted: forecast.hourly.precipitationProbability[i] >= HIGH_CHANCE })),
      hourlyUnit: "precip",
      stats: [
        { label: "Total", value: `${forecast.daily.precipitationInches[dayIndex]?.toFixed(1) ?? "0.0"} in` },
        { label: "Wind", value: windLabel(Math.max(...inWindow.map((i) => forecast.hourly.windSpeed[i]), 0), forecast.current.windDirection) },
        { label: "Gusts", value: `${round(forecast.current.windGusts)} mph` },
      ],
      attribution: "open-meteo.com · updated just now",
    };
  }

  const code = includesNow ? forecast.current.weatherCode : dominantCondition(inWindow.map((i) => forecast.hourly.weatherCode[i]));
  const temps = inWindow.map((i) => forecast.hourly.temperature[i]);
  const current = includesNow ? forecast.current.temperature : temps[0] ?? forecast.daily.tempMax[dayIndex];
  const peakIndex = inWindow[temps.indexOf(Math.max(...temps))] ?? dayIndex;

  return {
    kind: "weather",
    eyebrow: includesNow ? `Now · ${placeName}` : isTonight ? `Tonight · ${placeName}` : /\d/.test(window.label) ? `${dayWord} · ${window.label.replace(/^(today|tomorrow|tonight)\s*/i, "")}` : `${dayWord} · ${placeName}`,
    headline: `${round(current)}°`,
    condition: isFogQuestion ? "Fog" : conditionFor(code),
    insight: includesNow
      ? `${forecast.current.isDay ? "Warm and clear" : "Clear"}. Peaks at ${round(Math.max(...temps, current))}° around ${clockLabel(forecast.hourly.time[peakIndex])}, then cools after sunset.`
      : isFogQuestion ? `Low fog until about ${clockLabel(forecast.hourly.time[inWindow[inWindow.length - 1]] ?? forecast.hourly.time[dayIndex])}, visibility near ${(Math.min(...inWindow.map((i) => forecast.hourly.visibilityMiles[i])) || 1).toFixed(0)} mile. Roads stay dry.`
      : isTonight ? `Clear all night, down to ${round(forecast.daily.tempMin[dayIndex])}° by dawn.`
      : `${conditionFor(code)} ${window.label}.`,
    rangeLow: round(forecast.daily.tempMin[dayIndex]), rangeHigh: round(forecast.daily.tempMax[dayIndex]), current: round(current),
    hourly: sampled.map((i) => ({ label: shortHour(forecast.hourly.time[i]), value: round(forecast.hourly.temperature[i]), highlighted: instants[i] <= now && now < (instants[i + 1] ?? "9999") })),
    hourlyUnit: "temp",
    stats: isFogQuestion
      ? [{ label: "Visibility", value: `${(Math.min(...inWindow.map((i) => forecast.hourly.visibilityMiles[i])) || 1).toFixed(0)} mi` }, { label: "Wind", value: windLabel(forecast.hourly.windSpeed[inWindow[0] ?? dayIndex] ?? 0, forecast.current.windDirection) }, { label: "Humidity", value: `${round(forecast.current.humidity)}%` }]
      : isTonight
      ? [{ label: "Wind", value: `${round(forecast.hourly.windSpeed[inWindow[0] ?? dayIndex] ?? 0)} mph` }, { label: "Humidity", value: `${round(forecast.current.humidity)}%` }, { label: "Sunrise", value: clockLabel(forecast.daily.sunrise[dayIndex + 1] ?? forecast.daily.sunrise[dayIndex]) }]
      : [{ label: "Wind", value: windLabel(forecast.current.windSpeed, forecast.current.windDirection) }, { label: "UV", value: uvLabel(forecast.daily.uvIndexMax[dayIndex] ?? 0) }, { label: "Humidity", value: `${round(forecast.current.humidity)}%` }],
    attribution: "open-meteo.com · updated just now",
  };
}

function renderWeatherText(card: WeatherCardPayload): string {
  return `### ${card.eyebrow}\n\n${card.headline} ${card.condition}\n\n${card.insight}`;
}

/**
 * Real current/hourly/daily conditions from Open-Meteo (R32: the same reasoning already applied to places and
 * fares -- a search snippet is not a substitute for a source that actually has the data), for any of the mockup's
 * framings: now, a narrowed daypart tomorrow, a yes/no rain question days out, or tonight. Falls back to the
 * existing Tavily-backed general search on any failure -- a plain, if less structured, answer beats nothing.
 */
export async function answerWeather(input: string, place: string, userId: string, yesNo: boolean, context: { role: "user" | "assistant"; content: string }[] = [], today?: string, memoryContext = "", now: string = Temporal.Now.instant().toString()): Promise<string> {
  try {
    const geo = await geocodeLocation(place);
    if (!geo) return `I couldn't find a location for "${place}". Which city or ZIP code did you mean?`;
    const reading = await interpretTimeForUser({ message: input, today: today ?? Temporal.Now.zonedDateTimeISO(DEFAULT_TIME_ZONE).toPlainDate().toString(), timeZone: geo.timezone, userId, context });
    if (reading.kind === "unavailable") return TIME_UNAVAILABLE;
    if (reading.kind === "ask") return askAboutTime(reading.question, reading.choices);
    const forecast = await fetchForecast(geo.latitude, geo.longitude, geo.timezone);
    const card = buildWeatherCard({ forecast, placeName: geo.name, timeZone: geo.timezone, window: reading.window, yesNo, now });
    return embedCard(renderWeatherText(card), card);
  } catch {
    return answerPublicSearch(`${place} weather`, undefined, memoryContext, today);
  }
}
