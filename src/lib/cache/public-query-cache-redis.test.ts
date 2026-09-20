import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  return { get: vi.fn(), set: vi.fn() };
});
vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: () => ({ get: redis.get, set: redis.set }) } }));

import { withPublicQueryCache } from "./public-query-cache";

beforeEach(() => { redis.get.mockReset(); redis.set.mockReset().mockResolvedValue("OK"); });

describe("the saved-search cache with Redis (free)", () => {
  it("gives back text even though Redis returns a stored JSON string as an object", async () => {
    // What the Redis client does with a value like '{"text":"…","places":[]}': it parses it on the way out.
    redis.get.mockResolvedValue({ text: "Chinese restaurants in Sunnyvale", places: [] });
    const value = await withPublicQueryCache("best chinese restaurants in sunnyvale, ca", async () => "should not load");
    expect(typeof value).toBe("string");
    expect(JSON.parse(value)).toEqual({ text: "Chinese restaurants in Sunnyvale", places: [] });
  });

  it("returns a plain text value unchanged", async () => {
    redis.get.mockResolvedValue("an older plain answer");
    expect(await withPublicQueryCache("best chinese restaurants in sunnyvale, ca", async () => "x")).toBe("an older plain answer");
  });

  it("loads and stores when nothing is saved", async () => {
    redis.get.mockResolvedValue(null);
    expect(await withPublicQueryCache("best thai restaurants in oakland, ca", async () => '{"text":"fresh","places":[]}')).toBe('{"text":"fresh","places":[]}');
    expect(redis.set).toHaveBeenCalled();
  });
});
