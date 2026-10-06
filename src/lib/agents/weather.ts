import { extractPlaceForUser } from "./weather-place";
import { Temporal } from "@js-temporal/polyfill";
import { embedCard, type WeatherCardPayload, type WeatherAppearance } from "@/lib/chat/card-payload";
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
  const kind = rainy.some(i => [71,73,75,77,85,86].includes(hourly.weatherCode[i])) ? "snow" : "rain";
  const label = rainy.length === 1 ? `${kind === "rain" ? "Rain" : "Snow"}, ${clockLabel(hourly.time[rainy[0]])}` : `${kind === "rain" ? "Rain" : "Snow"}, ${clockLabel(hourly.time[rainy[0]])} to ${clockLabel(hourly.time[rainy[rainy.length - 1]])}`;
  const peakIndex = rainy.slice().sort((a, b) => hourly.precipitationProbability[b] - hourly.precipitationProbability[a])[0];
  return { kind, label, peakIndex };
}

const windLabel = (mph: number, direction: number) => `${round(mph)} mph ${["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(direction / 22.5) % 16]}`;
const uvLabel = (uv: number) => `${round(uv)} · ${uv >= 8 ? "Very High" : uv >= 6 ? "High" : uv >= 3 ? "Moderate" : "Low"}`;

type BuildInput = { forecast: Forecast; placeName: string; timeZone: string; window: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime; label: string }; yesNo: boolean; now: string };

/** Everything the card needs, computed once from the forecast + the resolved time window. No model in the loop --
 * every number and word comes straight from the API response, the same reasoning R32 already applied to places and fares. */
export function buildWeatherCard({ forecast, placeName, timeZone, window, yesNo, now }: BuildInput): WeatherCardPayload {
  const instants = hourlyInstants(forecast.hourly, timeZone);
  const windowStart = window.start.toInstant().toString();
  const windowEnd = window.end.toInstant().toString();
  const inWindow = instants.map((t, i) => i).filter((i) => Temporal.Instant.compare(instants[i], windowStart) >= 0 && Temporal.Instant.compare(instants[i], windowEnd) < 0);
  const dayKey = window.start.toPlainDate().toString();
  const dayIndex = forecast.daily.time.indexOf(dayKey);
  if (dayIndex < 0 || !inWindow.length) throw new Error("FORECAST_WINDOW_UNAVAILABLE");

  const includesNow = Temporal.Instant.compare(windowStart, now) <= 0 && Temporal.Instant.compare(now, windowEnd) < 0 && dayIndex === 0;
  const isTonight = /tonight|evening/i.test(window.label) && window.start.hour >= 17;
  const isFogQuestion = includesNow ? FOG_CODES.has(forecast.current.weatherCode) : inWindow.some((i) => FOG_CODES.has(forecast.hourly.weatherCode[i]));

  const dayWord = includesNow ? "Now" : isTonight ? "Tonight" : window.start.toLocaleString("en-US", { weekday: "long" });
  const currentHour = instants.findIndex((instant, i) => Temporal.Instant.compare(instant, now) <= 0 && (!instants[i+1] || Temporal.Instant.compare(now, instants[i+1]) < 0));
  const sampled = includesNow && currentHour >= 0
    ? instants.map((_, i) => i).slice(currentHour, currentHour + HOURLY_POINTS)
    : inWindow.slice(0, HOURLY_POINTS);
  const asOf = Temporal.Instant.from(now).toZonedDateTimeISO(timeZone).toLocaleString("en-US", {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
  const attribution = `Open-Meteo · as of ${asOf} · °F`;
  const hourlyLabel = yesNo ? "Hourly precipitation chance" : includesNow ? "Next hours · °F" : "Hourly forecast · °F";

  if (yesNo) {
    const assessment = rainAssessment(forecast.hourly, inWindow.length ? inWindow : [dayIndex]);
    const rainyStart = assessment ? inWindow.findIndex(i => forecast.hourly.precipitationProbability[i] >= HIGH_CHANCE) : -1;
    const rainHours = !includesNow && rainyStart >= 0 ? inWindow.slice(Math.max(0, rainyStart - 1), Math.max(0, rainyStart - 1) + HOURLY_POINTS) : sampled;
    return {
      kind: "weather", hourlyLabel, appearance: assessment ? assessment.kind : "cloud", eyebrow: `${dayWord} · ${assessment ? `chance of ${assessment.kind}` : "precipitation outlook"}`,
      headline: assessment ? "Yes" : "No", condition: assessment?.label ?? conditionFor(dominantCondition(inWindow.map((i) => forecast.hourly.weatherCode[i]))),
      insight: assessment ? `Showers ${window.label}, heaviest around ${clockLabel(forecast.hourly.time[assessment.peakIndex])}.` : `Rain is unlikely ${window.label}; peak precipitation chance is ${round(Math.max(...inWindow.map(i=>forecast.hourly.precipitationProbability[i])))}%.`,
      rangeLow: round(Math.min(...inWindow.map((i) => forecast.hourly.temperature[i]))), rangeHigh: round(Math.max(...inWindow.map((i) => forecast.hourly.temperature[i]))),
      current: round(forecast.hourly.temperature[inWindow[0] ?? dayIndex]),
      hourly: rainHours.map((i) => ({ label: shortHour(forecast.hourly.time[i]), value: round(forecast.hourly.precipitationProbability[i]), highlighted: forecast.hourly.precipitationProbability[i] >= HIGH_CHANCE })),
      hourlyUnit: "precip",
      stats: [
        { label: "Day total", value: `${forecast.daily.precipitationInches[dayIndex]?.toFixed(1) ?? "0.0"} in` },
        { label: "Wind max", value: `${round(Math.max(...inWindow.map((i) => forecast.hourly.windSpeed[i]), 0))} mph` },
        { label: "Peak chance", value: `${round(Math.max(...inWindow.map(i=>forecast.hourly.precipitationProbability[i])))}%` },
      ],
      attribution,
    };
  }

  const code = includesNow ? forecast.current.weatherCode : dominantCondition(inWindow.map((i) => forecast.hourly.weatherCode[i]));
  const temps = inWindow.map((i) => forecast.hourly.temperature[i]);
  const current = includesNow ? forecast.current.temperature : temps[0] ?? forecast.daily.tempMax[dayIndex];

  return {
    kind: "weather", hourlyLabel,
    appearance: FOG_CODES.has(code) ? "fog" : RAIN_CODES.has(code) ? "rain" : [71,73,75,77,85,86].includes(code) ? "snow" : code >= 2 ? "cloud" : (includesNow ? !forecast.current.isDay : isTonight) ? "night" : "sun",
    eyebrow: includesNow ? `Now · ${placeName}` : isTonight ? `Tonight · ${placeName}` : /\d/.test(window.label) ? `${dayWord} · ${window.label.replace(/^(today|tomorrow|tonight)\s*/i, "")}` : `${dayWord} · ${placeName}`,
    headline: `${round(current)}°`,
    condition: isFogQuestion ? "Fog" : conditionFor(code),
    insight: includesNow
      ? `${conditionFor(code)} now. ${sampled.length ? `The next hours range from ${round(Math.min(...sampled.map(i=>forecast.hourly.temperature[i])))}° to ${round(Math.max(...sampled.map(i=>forecast.hourly.temperature[i])))}°.` : ""}`
      : isFogQuestion ? `Fog in this window. Visibility as low as ${Math.min(...inWindow.map(i=>forecast.hourly.visibilityMiles[i])).toFixed(1)} mi.`
      : `${conditionFor(code)} ${window.label}. Temperatures from ${round(Math.min(...temps))}° to ${round(Math.max(...temps))}°.`,
    rangeLow: round(includesNow ? forecast.daily.tempMin[dayIndex] : Math.min(...temps)), rangeHigh: round(includesNow ? forecast.daily.tempMax[dayIndex] : Math.max(...temps)), current: round(current),
    hourly: sampled.map((i) => ({ label: shortHour(forecast.hourly.time[i]), value: round(forecast.hourly.temperature[i]), highlighted: i === currentHour && includesNow })),
    hourlyUnit: "temp",
    stats: !includesNow ? [
      { label: "Wind", value: `${round(Math.max(...inWindow.map(i=>forecast.hourly.windSpeed[i])))} mph max` },
      { label: isFogQuestion ? "Visibility" : "Rain chance", value: isFogQuestion ? `${Math.min(...inWindow.map(i=>forecast.hourly.visibilityMiles[i])).toFixed(0)} mi` : `${round(Math.max(...inWindow.map(i=>forecast.hourly.precipitationProbability[i])))}%` },
      isTonight ? { label: "Sunrise", value: clockLabel(forecast.daily.sunrise[dayIndex + 1] ?? forecast.daily.sunrise[dayIndex]) } : { label: "UV max", value: uvLabel(Math.max(...inWindow.map(i=>forecast.hourly.uvIndex[i]))) },
    ] : isFogQuestion
      ? [{ label: "Visibility", value: `${(Math.min(...inWindow.map((i) => forecast.hourly.visibilityMiles[i])) || 1).toFixed(0)} mi` }, { label: "Wind", value: windLabel(forecast.hourly.windSpeed[inWindow[0] ?? dayIndex] ?? 0, forecast.current.windDirection) }, { label: "Humidity", value: `${round(forecast.current.humidity)}%` }]
      : isTonight
      ? [{ label: "Wind", value: `${round(forecast.hourly.windSpeed[inWindow[0] ?? dayIndex] ?? 0)} mph` }, { label: "Humidity", value: `${round(forecast.current.humidity)}%` }, { label: "Sunrise", value: clockLabel(forecast.daily.sunrise[dayIndex + 1] ?? forecast.daily.sunrise[dayIndex]) }]
      : [{ label: "Wind", value: windLabel(forecast.current.windSpeed, forecast.current.windDirection) }, { label: "UV", value: uvLabel(forecast.daily.uvIndexMax[dayIndex] ?? 0) }, { label: "Humidity", value: `${round(forecast.current.humidity)}%` }],
    attribution,
  };
}

function dailyAppearance(code: number): WeatherAppearance {
  return FOG_CODES.has(code) ? "fog" : RAIN_CODES.has(code) ? "rain" : [71, 73, 75, 77, 85, 86].includes(code) ? "snow" : code >= 2 ? "cloud" : "sun";
}

/** The highest hourly chance of precipitation actually inside this calendar day -- Open-Meteo's daily fields have no
 * precipitation-probability of their own, only a total inches figure, which doesn't answer "will it rain Wednesday". */
function dayPrecipPercent(hourly: Forecast["hourly"], dateKey: string): number {
  const values = hourly.time.flatMap((time, i) => (time.startsWith(dateKey) ? [hourly.precipitationProbability[i]] : []));
  return values.length ? Math.max(...values) : 0;
}

/** A genuine multi-day range ("the next 7 days", "this week") -- found live: a 7-day window used to be read as if it
 * were a single, unusually long "now", because the single-day card's own includesNow check only ever looked at
 * whether the CURRENT MOMENT fell inside the window, which a week starting today always does. Built from the same
 * forecast.daily data buildWeatherCard already has in hand -- no second API call. Only days Open-Meteo actually
 * forecasts (up to 16) are shown; a request that reaches further than that says so honestly rather than inventing
 * a day with no real data behind it. */
function buildOutlookCard({ forecast, placeName, window, now }: { forecast: Forecast; placeName: string; window: BuildInput["window"]; now: string }): WeatherCardPayload {
  const startKey = window.start.toPlainDate().toString();
  const endKey = window.end.toPlainDate().toString(); // exclusive
  const indices = forecast.daily.time.map((_, i) => i).filter((i) => forecast.daily.time[i] >= startKey && forecast.daily.time[i] < endKey);
  if (!indices.length) throw new Error("FORECAST_WINDOW_UNAVAILABLE");
  const days = indices.map((i) => {
    const code = forecast.daily.weatherCode[i];
    return {
      label: Temporal.PlainDate.from(forecast.daily.time[i]).toLocaleString("en-US", { weekday: "short" }),
      high: round(forecast.daily.tempMax[i]), low: round(forecast.daily.tempMin[i]),
      condition: conditionFor(code), appearance: dailyAppearance(code),
      precipPercent: round(dayPrecipPercent(forecast.hourly, forecast.daily.time[i])),
    };
  });
  const highs = days.map((day) => day.high), lows = days.map((day) => day.low);
  const rainyDays = days.filter((day) => day.precipPercent >= 40).map((day) => day.label);
  const clipped = forecast.daily.time[forecast.daily.time.length - 1] < endKey;
  const insight = `Highs ${Math.min(...highs)}° to ${Math.max(...highs)}°, lows ${Math.min(...lows)}° to ${Math.max(...lows)}°.`
    + (rainyDays.length ? ` Rain chance on ${rainyDays.join(", ")}.` : "")
    + (clipped ? " Real forecasts only reach about two weeks out, so this covers what's available." : "");
  const asOf = Temporal.Instant.from(now).toZonedDateTimeISO(window.start.timeZoneId).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    kind: "weather", eyebrow: `${days.length}-day outlook · ${placeName}`, headline: `${Math.min(...lows)}°–${Math.max(...highs)}°`, condition: `${days.length} days`,
    insight, rangeLow: Math.min(...lows), rangeHigh: Math.max(...highs), current: round(forecast.current.temperature),
    hourly: [], hourlyUnit: "temp", stats: [], attribution: `Open-Meteo · as of ${asOf} · °F`, days,
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
export async function answerWeather(input: string, place: string, userId: string, yesNo: boolean, context: { role: "user" | "assistant"; content: string }[] = [], today?: string, memoryContext = "", now: string = Temporal.Now.instant().toString(), homeRegion = "", extract: (text: string) => Promise<string> = (text) => extractPlaceForUser(text, userId)): Promise<string> {
  try {
    // The place as given; failing that, just the place pulled out of a messy phrase; failing that -- only when the text names no place at
    // all -- the saved home. A place that IS named but can't be found is asked about, never swapped for home (that would answer the wrong city).
    let geo = await geocodeLocation(place);
    if (!geo) {
      const extracted = await extract(place);
      if (extracted && extracted.toLowerCase() !== place.trim().toLowerCase()) geo = await geocodeLocation(extracted);
      if (!geo && !extracted && homeRegion) geo = await geocodeLocation(homeRegion);
    }
    if (!geo) return `I couldn't find a location for "${place}". Which city or ZIP code did you mean?`;
    const reading = await interpretTimeForUser({ message: input, today: today ?? Temporal.Now.zonedDateTimeISO(DEFAULT_TIME_ZONE).toPlainDate().toString(), timeZone: geo.timezone, userId, context });
    if (reading.kind === "unavailable") return TIME_UNAVAILABLE;
    if (reading.kind === "ask") return askAboutTime(reading.question, reading.choices);
    const forecast = await fetchForecast(geo.latitude, geo.longitude, geo.timezone);
    // A window spanning several real calendar days ("the next 7 days", "this week") needs a day-by-day outlook,
    // never the single-day card -- a 2-day window ("the weekend") still reads fine as one blended day for now.
    const spanDays = Math.round(reading.window.start.until(reading.window.end, { largestUnit: "hours" }).hours / 24);
    const card = spanDays >= 3
      ? buildOutlookCard({ forecast, placeName: geo.name, window: reading.window, now })
      : buildWeatherCard({ forecast, placeName: geo.name, timeZone: geo.timezone, window: reading.window, yesNo, now });
    return embedCard(renderWeatherText(card), card);
  } catch {
    return answerPublicSearch(`${place} weather`, undefined, memoryContext, today);
  }
}
