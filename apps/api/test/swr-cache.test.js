import { describe, expect, it, vi } from "vitest";
import { createSwrCache } from "../src/lib/swr-cache.js";

describe("swr-cache", () => {
  it("fresco → cached; vencido + origem ok → refetch; vencido + origem off → stale", async () => {
    vi.useFakeTimers();
    const cache = createSwrCache({ freshMs: 1000, staleMs: 5000 });
    let calls = 0;
    const ok = async () => ({ n: ++calls });
    const fail = async () => {
      throw new Error("down");
    };

    expect(await cache.getOrFetch("k", ok)).toEqual({ value: { n: 1 }, cached: false, stale: false });
    expect(await cache.getOrFetch("k", ok)).toEqual({ value: { n: 1 }, cached: true, stale: false });

    vi.advanceTimersByTime(1500);
    expect(await cache.getOrFetch("k", ok)).toEqual({ value: { n: 2 }, cached: false, stale: false });

    vi.advanceTimersByTime(1500);
    expect(await cache.getOrFetch("k", fail)).toEqual({ value: { n: 2 }, cached: true, stale: true });

    vi.advanceTimersByTime(6000);
    await expect(cache.getOrFetch("k", fail)).rejects.toThrow("down");
    vi.useRealTimers();
  });

  it("single-flight: chamadas simultâneas viram 1 fetch", async () => {
    const cache = createSwrCache({ freshMs: 1000, staleMs: 5000 });
    let calls = 0;
    const slow = () => new Promise((r) => setTimeout(() => r(++calls), 20));
    const results = await Promise.all([cache.getOrFetch("s", slow), cache.getOrFetch("s", slow), cache.getOrFetch("s", slow)]);
    expect(calls).toBe(1);
    expect(results.map((r) => r.value)).toEqual([1, 1, 1]);
  });
});
