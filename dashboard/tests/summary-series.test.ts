import { describe, expect, it } from "vitest";
import { brandSeries, seriesMax } from "@/lib/summary/series";

const ROWS = [
  { day: "2026-11-17", kertas_supreme: 3, imperial_indopack: 1 },
  { day: "2026-11-18", kertas_supreme: 0, imperial_indopack: 0 },
];

describe("brandSeries", () => {
  it("two bars per day, Kertas Supreme first", () =>
    expect(brandSeries(ROWS, null)[0].bars).toEqual([
      { brand: "kertas_supreme", n: 3 },
      { brand: "imperial_indopack", n: 1 },
    ]));
  it("one bar when a brand is filtered", () =>
    expect(brandSeries(ROWS, "imperial_indopack")[0].bars).toEqual([{ brand: "imperial_indopack", n: 1 }]));
  it("max is never zero", () => expect(seriesMax(brandSeries([ROWS[1]], null))).toBe(1));
  it("max is the tallest bar", () => expect(seriesMax(brandSeries(ROWS, null))).toBe(3));
});
