import { describe, expect, it } from "vitest";
import { formatQty, formatWait, relativeTime } from "@/lib/format";
import { BRAND_TAG, brandSlugs } from "@/lib/brands";

describe("format helpers", () => {
  it("formats quantities", () => {
    expect(formatQty(5000, "pcs", "id")).toBe("5.000 pcs (10 rim)");
    expect(formatQty(12, "rim", "id")).toBe("12 rim (6.000 pcs)");
    expect(formatQty(2700, "pcs", "id")).toBe("2.700 pcs");
  });

  it("formats waiting time", () => {
    expect(formatWait(18, "id")).toBe("18 mnt");
    expect(formatWait(72, "id")).toBe("1 j 12 mnt");
    expect(formatWait(72, "en")).toBe("1 h 12 min");
    expect(formatWait(1560, "id")).toBe("1 hr 2 j");
  });

  it("relative time in WIB", () => {
    const now = new Date("2026-11-18T10:00:00+07:00");
    expect(relativeTime("2026-11-18T09:50:00+07:00", now, "id")).toBe("10 mnt lalu");
    expect(relativeTime("2026-11-18T09:00:00+07:00", now, "id")).toBe("1 jam lalu");
    expect(relativeTime("2026-11-17T15:00:00+07:00", now, "id")).toBe("kemarin");
    expect(relativeTime("2026-11-15T10:00:00+07:00", now, "id")).toBe("3 hari lalu");
  });

  it("brand tags and slugs", () => {
    expect(BRAND_TAG.kertas_supreme.color).toBe("#445428");
    expect(BRAND_TAG.imperial_indopack.background).toBe("#F4EBD8");
    expect(brandSlugs(["imperial_indopack", "other_brand", "kertas_supreme"])).toEqual([
      "kertas_supreme",
      "imperial_indopack",
    ]);
  });
});
