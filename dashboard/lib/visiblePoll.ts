import { useEffect, useRef } from "react";

// The live screens (Perlu Tim, a Percakapan chat) poll by re-running their server page. A tab nobody
// is looking at should not: while the page is hidden nothing is fetched, and when it is shown again it
// refreshes once straight away, then resumes the interval.

/** The bit of `document` the poll needs - a parameter so the logic is testable without a browser. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Calls `tick` every `ms` while `doc` is visible, and once when it becomes visible again. Returns the stop function. */
export function startVisiblePoll(doc: VisibilitySource, tick: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const visible = () => doc.visibilityState === "visible";
  const start = () => {
    if (timer === null) timer = setInterval(() => (visible() ? tick() : stop()), ms);
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (!visible()) return stop();
    tick();
    stop();
    start();
  };
  if (visible()) start();
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Client components only: startVisiblePoll on `document` for the component's lifetime; the latest `tick` is the one called. */
export function useVisiblePoll(tick: () => void, ms: number): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });
  useEffect(() => startVisiblePoll(document, () => latest.current(), ms), [ms]);
}
