import { describe, expect, it } from "vitest";
import { namesPrice, quoteSnippet, staffPriceAfterBotQuote } from "@/lib/conversations/staffPrice";

const bot = (body: string) => ({ role: "assistant" as const, body, senderName: null });
const staff = (body: string) => ({ role: "assistant" as const, body, senderName: "Tim CS" });
const customer = (body: string) => ({ role: "user" as const, body, senderName: null });

describe("namesPrice", () => {
  it("spots Rp and informal prices", () => {
    for (const s of ["Rp 4.500.000", "Rp1.150", "buletin ke 3 juta", "4,5jt", "185rb", "3k", "1.234/pcs", "1.234 per rim"]) {
      expect(namesPrice(s), s).toBe(true);
    }
  });
  it("does not treat quantities as prices", () => {
    for (const s of ["10 ribu pcs", "2 juta lembar", "5rb biji", "halo kak", "ukuran 30x40"]) {
      expect(namesPrice(s), s).toBe(false);
    }
  });
});

describe("staffPriceAfterBotQuote", () => {
  it("warns when staff named a price after the bot's quote", () => {
    const hit = staffPriceAfterBotQuote([customer("harga?"), bot("Rp 1.234/pcs"), customer("nego"), staff("buletin ke 3 juta")]);
    expect(hit?.body).toBe("buletin ke 3 juta");
  });
  it("does not warn when the bot quoted after the staff price", () => {
    expect(staffPriceAfterBotQuote([staff("buletin ke 3 juta"), customer("ok"), bot("Rp 1.234/pcs")])).toBeNull();
  });
  it("ignores a quantity and non-price staff chatter", () => {
    expect(staffPriceAfterBotQuote([bot("Rp 1.234/pcs"), staff("siap, 10 ribu pcs ya")])).toBeNull();
  });
  it("does not warn when nothing names a price", () => {
    expect(staffPriceAfterBotQuote([customer("halo"), bot("Halo kak"), staff("Baik kak")])).toBeNull();
    expect(staffPriceAfterBotQuote([])).toBeNull();
  });
});

describe("quoteSnippet", () => {
  it("cuts long text at ~80 chars", () => {
    expect(quoteSnippet("a".repeat(100))).toBe(`${"a".repeat(80)}…`);
    expect(quoteSnippet("ke  3\njuta")).toBe("ke 3 juta");
  });
});
