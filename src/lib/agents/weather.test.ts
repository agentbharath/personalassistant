import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ interpretTime: vi.fn(), geocode: vi.fn(), forecast: vi.fn(), publicSearch: vi.fn() }));
vi.mock("./time-interpreter-runtime", () => ({ interpretTimeForUser: mocks.interpretTime }));
vi.mock("@/lib/tools/weather/open-meteo", async (importOriginal) => ({ ...(await importOriginal<object>()), geocodeLocation: mocks.geocode, fetchForecast: mocks.forecast }));
vi.mock("./general", () => ({ answerPublicSearch: mocks.publicSearch }));
import { Temporal } from "@js-temporal/polyfill";
import { answerWeather } from "./weather";

const TZ = "America/Los_Angeles";
const GEO = { name: "Sunnyvale, CA", latitude: 37.37, longitude: -122.03, timezone: TZ };
const window = (startISO: string, endISO: string, label: string) => ({ start: Temporal.ZonedDateTime.from(`${startISO}[${TZ}]`), end: Temporal.ZonedDateTime.from(`${endISO}[${TZ}]`), label });

/** One day of hourly entries (local "YYYY-MM-DDTHH:mm" strings, no offset -- matches Open-Meteo's own format under an explicit IANA timezone param) from a per-hour generator. */
function hoursFor(date: string, gen: (hour: number) => { temp: number; precip: number; wind: number; visibility: number; uv: number; code: number }) {
  const time: string[] = [], temperature: number[] = [], precipitationProbability: number[] = [], windSpeed: number[] = [], visibilityMiles: number[] = [], uvIndex: number[] = [], weatherCode: number[] = [];
  for (let h = 0; h < 24; h++) {
    const v = gen(h);
    time.push(`${date}T${String(h).padStart(2, "0")}:00`);
    temperature.push(v.temp); precipitationProbability.push(v.precip); windSpeed.push(v.wind); visibilityMiles.push(v.visibility); uvIndex.push(v.uv); weatherCode.push(v.code);
  }
  return { time, temperature, precipitationProbability, windSpeed, visibilityMiles, uvIndex, weatherCode };
}
beforeEach(() => vi.clearAllMocks());

describe("current conditions (\"now\" mode)", () => {
  it("reads the current temperature and condition, with wind/UV/humidity stats", async () => {
    mocks.geocode.mockResolvedValue(GEO);
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T00:00:00", "2026-09-29T00:00:00", "today"), moment: null, place: null });
    const day0 = hoursFor("2026-09-28", (h) => ({ temp: 65 + Math.max(0, 10 - Math.abs(h - 15)), precip: 0, wind: 7, visibility: 10, uv: h === 15 ? 7 : 3, code: 0 }));
    mocks.forecast.mockResolvedValue({
      current: { time: "2026-09-28T15:00", temperature: 77, humidity: 38, weatherCode: 0, windSpeed: 7, windDirection: 315, windGusts: 12, isDay: true },
      hourly: day0,
      daily: { time: ["2026-09-28"], tempMax: [79], tempMin: [54], sunrise: ["2026-09-28T07:00"], sunset: ["2026-09-28T19:00"], precipitationInches: [0], uvIndexMax: [7], weatherCode: [0] },
    });
    const answer = await answerWeather("Sunnyvale weather", "Sunnyvale, CA", "u1", false, [], "2026-09-28", "", "2026-09-28T22:00:00Z");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.eyebrow).toBe("Now · Sunnyvale, CA");
    expect(card.headline).toBe("77°");
    expect(card.condition).toBe("Clear sky");
    expect(card.rangeLow).toBe(54);
    expect(card.rangeHigh).toBe(79);
    expect(card.hourly.map((h: {label:string})=>h.label)).toEqual(["3PM","4PM","5PM","6PM","7PM","8PM"]);
    expect(card.hourly[0].highlighted).toBe(true);
    expect(card.appearance).toBe("sun");
    expect(card.stats.map((s: { label: string }) => s.label)).toEqual(["Wind", "UV", "Humidity"]);
    expect(card.stats[0].value).toBe("7 mph NW");
  });
});

describe("a narrowed daypart window (found live fix upstream: this now arrives as an actual sub-range, not a whole day)", () => {
  it("detects fog within the window and shows visibility/wind/humidity stats", async () => {
    mocks.geocode.mockResolvedValue(GEO);
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-29T06:00:00", "2026-09-29T08:00:00", "tomorrow morning"), moment: null, place: null });
    const day1 = hoursFor("2026-09-29", (h) => ({ temp: 54, precip: 0, wind: 4, visibility: h >= 6 && h <= 8 ? 1 : 8, uv: 0, code: h >= 6 && h <= 8 ? 45 : 1 }));
    mocks.forecast.mockResolvedValue({
      current: { time: "2026-09-28T15:00", temperature: 70, humidity: 92, weatherCode: 0, windSpeed: 4, windDirection: 270, windGusts: 8, isDay: true },
      hourly: day1,
      daily: { time: ["2026-09-28", "2026-09-29"], tempMax: [79, 71], tempMin: [54, 53], sunrise: ["2026-09-28T07:00", "2026-09-29T07:01"], sunset: ["2026-09-28T19:00", "2026-09-29T18:58"], precipitationInches: [0, 0], uvIndexMax: [7, 6], weatherCode: [0, 45] },
    });
    const answer = await answerWeather("is it foggy for my run tomorrow", "Sunnyvale, CA", "u1", false, [], "2026-09-28", "", "2026-09-28T15:00:00Z");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.condition).toBe("Fog");
    expect(card.stats.map((s: { label: string }) => s.label)).toEqual(["Wind", "Visibility", "UV max"]);
    expect(card.stats[1].value).toBe("1 mi");
  });
});

describe("a yes/no rain question (weatherYesNo)", () => {
  it("answers Yes with the contiguous rainy hour range as the condition label", async () => {
    mocks.geocode.mockResolvedValue(GEO);
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-29T00:00:00", "2026-09-30T00:00:00", "Tuesday"), moment: null, place: null });
    const day1 = hoursFor("2026-09-29", (h) => ({ temp: 60, precip: h >= 14 && h <= 19 ? 80 : 10, wind: 14, visibility: 10, uv: 0, code: h >= 14 && h <= 19 ? 61 : 2 }));
    mocks.forecast.mockResolvedValue({
      current: { time: "2026-09-28T15:00", temperature: 70, humidity: 60, weatherCode: 0, windSpeed: 14, windDirection: 180, windGusts: 25, isDay: true },
      hourly: day1,
      daily: { time: ["2026-09-28", "2026-09-29"], tempMax: [79, 63], tempMin: [54, 52], sunrise: ["2026-09-28T07:00", "2026-09-29T07:01"], sunset: ["2026-09-28T19:00", "2026-09-29T18:58"], precipitationInches: [0, 0.4], uvIndexMax: [7, 5], weatherCode: [0, 61] },
    });
    const answer = await answerWeather("do I need an umbrella Tuesday", "Sunnyvale, CA", "u1", true, [], "2026-09-28", "", "2026-09-28T15:00:00Z");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.headline).toBe("Yes");
    expect(card.condition).toBe("Rain, 2 PM to 7 PM");
    expect(card.hourlyUnit).toBe("precip");
    expect(card.stats).toEqual([{ label: "Day total", value: "0.4 in" }, { label: "Wind max", value: "14 mph" }, { label: "Peak chance", value: "80%" }]);
  });

  it("answers No when nothing crosses the high-chance threshold, without inventing a snow chance (found live: a dry October day in Sunnyvale came back \"chance of snow\" -- the eyebrow's rain-vs-snow word was computed from the whole day's dominant code, not from the actually-rainy hours, so a merely-non-rain code like \"mainly clear\" defaulted to \"snow\")", async () => {
    mocks.geocode.mockResolvedValue(GEO);
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-29T00:00:00", "2026-09-30T00:00:00", "Tuesday"), moment: null, place: null });
    const day1 = hoursFor("2026-09-29", () => ({ temp: 60, precip: 10, wind: 5, visibility: 10, uv: 3, code: 1 })); // 1 = "Mainly clear", not a rain code and not a snow code either
    mocks.forecast.mockResolvedValue({
      current: { time: "2026-09-28T15:00", temperature: 70, humidity: 40, weatherCode: 0, windSpeed: 5, windDirection: 90, windGusts: 9, isDay: true },
      hourly: day1,
      daily: { time: ["2026-09-28", "2026-09-29"], tempMax: [79, 63], tempMin: [54, 52], sunrise: ["2026-09-28T07:00", "2026-09-29T07:01"], sunset: ["2026-09-28T19:00", "2026-09-29T18:58"], precipitationInches: [0, 0], uvIndexMax: [7, 3], weatherCode: [0, 1] },
    });
    const answer = await answerWeather("will it rain Tuesday", "Sunnyvale, CA", "u1", true, [], "2026-09-28", "", "2026-09-28T15:00:00Z");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.headline).toBe("No");
    expect(card.eyebrow).not.toContain("snow");
    expect(card.eyebrow).toBe("Tuesday · precipitation outlook");
    expect(card.condition).toBe("Mainly clear");
  });
});

describe("tonight", () => {
  it("shows wind/humidity/sunrise stats instead of the usual wind/UV/humidity", async () => {
    mocks.geocode.mockResolvedValue(GEO);
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T17:00:00", "2026-09-29T00:00:00", "tonight"), moment: null, place: null });
    const day0 = hoursFor("2026-09-28", (h) => ({ temp: h >= 17 ? 58 - (h - 17) : 65, precip: 0, wind: 3, visibility: 10, uv: 0, code: 0 }));
    mocks.forecast.mockResolvedValue({
      current: { time: "2026-09-28T15:00", temperature: 70, humidity: 70, weatherCode: 0, windSpeed: 3, windDirection: 0, windGusts: 5, isDay: false },
      hourly: day0,
      daily: { time: ["2026-09-28", "2026-09-29"], tempMax: [79, 71], tempMin: [51, 55], sunrise: ["2026-09-28T07:00", "2026-09-29T07:03"], sunset: ["2026-09-28T19:00", "2026-09-29T18:58"], precipitationInches: [0, 0], uvIndexMax: [7, 6], weatherCode: [0, 0] },
    });
    const answer = await answerWeather("will it be clear tonight", "Sunnyvale, CA", "u1", false, [], "2026-09-28", "", "2026-09-28T15:00:00Z");
    const card = JSON.parse(answer.match(/```daylark-card\n([\s\S]*?)\n```/)![1]);
    expect(card.eyebrow).toBe("Tonight · Sunnyvale, CA");
    expect(card.stats.map((s: { label: string }) => s.label)).toEqual(["Wind", "Rain chance", "Sunrise"]);
    expect(card.stats[2].value).toBe("7:03 AM");
  });
});

describe("degradation, never a crash", () => {
  it("asks which city or ZIP when geocoding finds nothing, even for the place pulled out of the phrase", async () => {
    mocks.geocode.mockResolvedValue(null);
    const answer = await answerWeather("what's the weather", "Nowhereville", "u1", false, [], undefined, "", undefined, "Sunnyvale, CA", async () => "Nowhereville Heights");
    expect(answer).toContain("couldn't find a location");
    expect(answer).not.toContain("daylark-card");
    expect(mocks.geocode).not.toHaveBeenCalledWith("Sunnyvale, CA");
  });

  it("pulls just the place out of a messy phrase the geocoder can't read (found live: \"weather forecast Sunnyvale, CA next 7 days\" dead-ended)", async () => {
    mocks.geocode.mockImplementation(async (query: string) => (query === "Sunnyvale, CA" ? GEO : null));
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T00:00:00", "2026-09-29T00:00:00", "today"), moment: null, place: null });
    mocks.forecast.mockRejectedValue(new Error("stop after place resolution"));
    mocks.publicSearch.mockResolvedValue("plain search");
    const extract = vi.fn().mockResolvedValue("Sunnyvale, CA");
    await answerWeather("Weather for next 7 days", "weather forecast Sunnyvale, CA next 7 days", "u1", false, [], undefined, "", undefined, "Sunnyvale, CA", extract);
    expect(extract).toHaveBeenCalledWith("weather forecast Sunnyvale, CA next 7 days");
    expect(mocks.forecast).toHaveBeenCalled();
  });

  it("uses the saved home only when the text names no place at all", async () => {
    mocks.geocode.mockImplementation(async (query: string) => (query === "Sunnyvale, CA" ? GEO : null));
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T00:00:00", "2026-09-29T00:00:00", "today"), moment: null, place: null });
    mocks.forecast.mockRejectedValue(new Error("stop after place resolution"));
    mocks.publicSearch.mockResolvedValue("plain search");
    await answerWeather("Weather for next 7 days", "next 7 days", "u1", false, [], undefined, "", undefined, "Sunnyvale, CA", async () => "");
    expect(mocks.forecast).toHaveBeenCalled();
    mocks.forecast.mockClear();
    const none = await answerWeather("Weather", "next 7 days", "u1", false, [], undefined, "", undefined, "", async () => "");
    expect(none).toContain("couldn't find a location");
    expect(mocks.forecast).not.toHaveBeenCalled();
  });

  it("asks about the time instead of guessing when it's ambiguous", async () => {
    mocks.geocode.mockResolvedValue(GEO);
    mocks.interpretTime.mockResolvedValue({ kind: "ask", question: "Which day?", choices: ["today", "tomorrow"] });
    const answer = await answerWeather("what's the weather", "Sunnyvale, CA", "u1", false, []);
    expect(answer).toBe("Which day? (today / tomorrow)");
  });

  it("falls back to the general search when the forecast call itself fails", async () => {
    mocks.geocode.mockResolvedValue(GEO);
    mocks.interpretTime.mockResolvedValue({ kind: "window", window: window("2026-09-28T00:00:00", "2026-09-29T00:00:00", "today"), moment: null, place: null });
    mocks.forecast.mockRejectedValue(new Error("network"));
    mocks.publicSearch.mockResolvedValue("FALLBACK");
    const answer = await answerWeather("what's the weather", "Sunnyvale, CA", "u1", false, []);
    expect(answer).toBe("FALLBACK");
    expect(mocks.publicSearch).toHaveBeenCalledWith("Sunnyvale, CA weather", undefined, "", undefined);
  });
});
