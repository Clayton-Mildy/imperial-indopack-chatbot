import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisiblePoll, type VisibilitySource } from "@/lib/visiblePoll";

/** A document stand-in whose visibility the test flips. */
function fakeDoc(initial: "visible" | "hidden") {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial as string,
    addEventListener: (_t: "visibilitychange", l: () => void) => void listeners.add(l),
    removeEventListener: (_t: "visibilitychange", l: () => void) => void listeners.delete(l),
  } satisfies VisibilitySource;
  const set = (state: "visible" | "hidden") => {
    doc.visibilityState = state;
    for (const l of [...listeners]) l();
  };
  return { doc, set, listeners };
}

describe("startVisiblePoll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks every interval while visible", () => {
    const { doc } = fakeDoc("visible");
    const tick = vi.fn();
    startVisiblePoll(doc, tick, 5000);
    vi.advanceTimersByTime(15_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("a hidden tab polls nothing; shown again, it refreshes once at once, then resumes", () => {
    const { doc, set } = fakeDoc("visible");
    const tick = vi.fn();
    startVisiblePoll(doc, tick, 5000);
    set("hidden");
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
    set("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("opened in a hidden tab: nothing until it is shown", () => {
    const { doc, set } = fakeDoc("hidden");
    const tick = vi.fn();
    startVisiblePoll(doc, tick, 3000);
    vi.advanceTimersByTime(30_000);
    expect(tick).not.toHaveBeenCalled();
    set("visible");
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("stop clears the timer and the listener", () => {
    const { doc, set, listeners } = fakeDoc("visible");
    const tick = vi.fn();
    const stop = startVisiblePoll(doc, tick, 3000);
    stop();
    expect(listeners.size).toBe(0);
    set("visible");
    vi.advanceTimersByTime(30_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
