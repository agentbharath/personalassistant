import { assertToolAllowed } from "@/lib/agents/registry";
import { resilientFetch } from "@/lib/runtime/resilient-fetch";

/** WMO "ww" weather codes (shared by current/hourly/daily weather_code fields). Free, keyless, CC-BY 4.0 (open-meteo.com). */
export const WMO_CONDITIONS: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing rime fog",
  51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle", 56: "Light freezing drizzle", 57: "Dense freezing drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 66: "Light freezing rain", 67: "Heavy freezing rain",
  71: "Slight snowfall", 73: "Moderate snowfall", 75: "Heavy snowfall", 77: "Snow grains",
  80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
  85: "Slight snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};
export const FOG_CODES = new Set([45, 48]);
export const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
export const conditionFor = (code: number) => WMO_CONDITIONS[code] ?? "Unknown";

export type GeocodedPlace = { name: string; latitude: number; longitude: number; timezone: string };

type GeocodingResponse = { results?: Array<{ name: string; latitude: number; longitude: number; timezone: string; admin1?: string; country_code?: string }> };

async function geocodeOnce(query: string): Promise<GeocodedPlace | null> {
  assertToolAllowed("general", "web.search_weather");
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  const response = await resilientFetch("open_meteo", url, {}, { timeoutMs: 6_000, maxAttempts: 2 });
  if (!response.ok) throw new Error(`OPEN_METEO_GEOCODE_${response.status}`);
  const body = await response.json() as GeocodingResponse;
  const first = body.results?.[0];
  if (!first) return null;
  const label = [first.name, first.admin1 && first.admin1 !== first.name ? first.admin1 : first.country_code].filter(Boolean).join(", ");
  return { name: label, latitude: first.latitude, longitude: first.longitude, timezone: first.timezone };
}

/** The place name a person would recognize ("Sunnyvale, CA"), from Open-Meteo's own free geocoder -- no Google Maps key needed. Null when
 * nothing matched. Open-Meteo's geocoder does exact-ish name matching with no tolerance for a trailing word that isn't part of the place
 * itself: "Sunnyvale, CA weather today" matches nothing even though "Sunnyvale, CA" alone matches instantly (found live: a router call
 * occasionally folds a stray word like "weather" or "today" into the place instead of keeping searchQuery to just the place, its own
 * instruction notwithstanding -- a model-following slip, not something worth chasing away entirely with more prompt wording alone). Retries
 * with the trailing word dropped, up to three times, before giving up -- cheap (a query that already matches returns on the first try) and
 * it turns an outright "I couldn't find that" into the right answer whenever the real place name was there all along, just not alone. */
export async function geocodeLocation(query: string): Promise<GeocodedPlace | null> {
  const words = query.trim().split(/\s+/);
  for (let drop = 0; drop <= Math.min(3, words.length - 1); drop += 1) {
    const result = await geocodeOnce(words.slice(0, words.length - drop).join(" "));
    if (result) return result;
  }
  return null;
}

export type Forecast = {
  current: { time: string; temperature: number; humidity: number; weatherCode: number; windSpeed: number; windDirection: number; windGusts: number; isDay: boolean };
  hourly: { time: string[]; temperature: number[]; precipitationProbability: number[]; windSpeed: number[]; visibilityMiles: number[]; uvIndex: number[]; weatherCode: number[] };
  daily: { time: string[]; tempMax: number[]; tempMin: number[]; sunrise: string[]; sunset: string[]; precipitationInches: number[]; uvIndexMax: number[]; weatherCode: number[] };
};

type ForecastResponse = {
  current: { time: string; temperature_2m: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number; wind_gusts_10m: number; is_day: number };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; wind_speed_10m: number[]; visibility: number[]; uv_index: number[]; weather_code: number[] };
  hourly_units: { visibility: string };
  daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; sunrise: string[]; sunset: string[]; precipitation_sum: number[]; uv_index_max: number[]; weather_code: number[] };
};

/** Imperial units throughout (°F, mph, inches) -- matches how a US person reads a forecast, and how the mockup itself is written. Visibility
 * comes back in feet under imperial wind units (Open-Meteo ties it to wind_speed_unit, not its own param); converted to miles here so callers
 * never touch the raw unit. forecastDays bounds how many days out the daily/hourly arrays reach (max 16 on the free tier). */
export async function fetchForecast(latitude: number, longitude: number, timezone: string, forecastDays = 10): Promise<Forecast> {
  assertToolAllowed("general", "web.search_weather");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("forecast_days", String(forecastDays));
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,wind_speed_10m,visibility,uv_index,weather_code");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,uv_index_max,weather_code");
  const response = await resilientFetch("open_meteo", url, {}, { timeoutMs: 6_000, maxAttempts: 2 });
  if (!response.ok) throw new Error(`OPEN_METEO_FORECAST_${response.status}`);
  const body = await response.json() as ForecastResponse;
  const feetToMiles = body.hourly_units.visibility === "ft" ? 1 / 5280 : 1 / 1609.34;
  return {
    current: {
      time: body.current.time, temperature: body.current.temperature_2m, humidity: body.current.relative_humidity_2m,
      weatherCode: body.current.weather_code, windSpeed: body.current.wind_speed_10m, windDirection: body.current.wind_direction_10m,
      windGusts: body.current.wind_gusts_10m, isDay: body.current.is_day === 1,
    },
    hourly: {
      time: body.hourly.time, temperature: body.hourly.temperature_2m, precipitationProbability: body.hourly.precipitation_probability,
      windSpeed: body.hourly.wind_speed_10m, visibilityMiles: body.hourly.visibility.map((value) => value * feetToMiles),
      uvIndex: body.hourly.uv_index, weatherCode: body.hourly.weather_code,
    },
    daily: {
      time: body.daily.time, tempMax: body.daily.temperature_2m_max, tempMin: body.daily.temperature_2m_min,
      sunrise: body.daily.sunrise, sunset: body.daily.sunset, precipitationInches: body.daily.precipitation_sum,
      uvIndexMax: body.daily.uv_index_max, weatherCode: body.daily.weather_code,
    },
  };
}
