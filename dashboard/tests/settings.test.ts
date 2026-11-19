import { describe, expect, it } from "vitest";
import { goLiveIssueLine, minOrderHint, sectionLabelKey, validatePoUrl } from "@/lib/settings";
import { id } from "@/lib/i18n/id";
import { en } from "@/lib/i18n/en";
import { makeT } from "@/lib/i18n/core";
import type { GoLiveIssue } from "@/types/api";

describe("validatePoUrl", () => {
  it("validates the PO link", () => {
    expect(validatePoUrl("https://forms.gle/abc")).toBe("ok");
    expect(validatePoUrl("http://forms.gle/abc")).toBe("not_https");
    expect(validatePoUrl("forms.gle")).toBe("invalid");
    expect(validatePoUrl("https://")).toBe("invalid");
  });

  it("takes the client's real form links, and trims what staff paste", () => {
    expect(validatePoUrl("https://forms.gle/mybbNDzzfEETKP9h9")).toBe("ok");
    expect(validatePoUrl("  https://forms.gle/eiw2k43yrhTZ6odbA \n")).toBe("ok");
    expect(validatePoUrl("HTTPS://docs.google.com/forms/d/e/x/viewform")).toBe("ok");
  });

  it("refuses everything that is not an https link with a host", () => {
    for (const bad of ["", "   ", "ftp://forms.gle/abc", "javascript:alert(1)", "https:forms.gle", "https:// forms.gle"]) {
      expect(validatePoUrl(bad)).toBe("invalid");
    }
    expect(validatePoUrl("HTTP://forms.gle/abc")).toBe("not_https");
  });
});

describe("minOrderHint", () => {
  it("minimum hint", () => {
    expect(minOrderHint(2500, "id")).toBe("pcs (5 rim)");
    expect(minOrderHint(1200, "id")).toBe("pcs");
  });

  it("groups a large rim count the language's way", () => {
    expect(minOrderHint(500_000, "id")).toBe("pcs (1.000 rim)");
    expect(minOrderHint(500_000, "en")).toBe("pcs (1,000 rim)");
    expect(minOrderHint(0, "id")).toBe("pcs");
  });
});

describe("sectionLabelKey", () => {
  it("section labels", () => {
    expect(id[sectionLabelKey("Escalation") as keyof typeof id]).toBe("Serahkan ke tim");
    expect(sectionLabelKey("Custom")).toBe("Custom");
  });

  it("labels every shipped prompt section as the design names it", () => {
    const want: Record<string, string> = {
      Identity: "Identitas",
      Mission: "Misi",
      Tone: "Nada",
      Brands: "Merek",
      "Order Details": "Detail pesanan",
      Recommendations: "Rekomendasi",
      Pricing: "Harga",
      Design: "Desain",
      "PO Form": "Form PO",
      Rules: "Aturan",
      Escalation: "Serahkan ke tim",
    };
    for (const [name, label] of Object.entries(want)) {
      const key = sectionLabelKey(name);
      expect(key in id, name).toBe(true);
      expect(id[key as keyof typeof id]).toBe(label);
      expect(en[key as keyof typeof en], name).toBeTruthy();
    }
  });
});

describe("goLiveIssueLine", () => {
  const t = makeT("id");
  it("one line per issue, in the banner's words, linking to where it is fixed", () => {
    expect(goLiveIssueLine({ code: "po_form_placeholder", form: "cetak" }, t)).toEqual({ text: "Link form order cetak masih contoh", href: "#pemesanan" });
    expect(goLiveIssueLine({ code: "po_form_placeholder", form: "plano" }, t)).toEqual({ text: "Link form order plano masih contoh", href: "#pemesanan" });
    expect(goLiveIssueLine({ code: "whatsapp_not_connected" }, t)).toEqual({ text: "Nomor WhatsApp belum terhubung", href: "#whatsapp" });
    expect(goLiveIssueLine({ code: "catalog_empty" }, t)).toEqual({ text: "Katalog masih kosong", href: "/catalog" });
    expect(goLiveIssueLine({ code: "catalog_demo" }, t)).toEqual({ text: "Katalog berisi data contoh (CONTOH) — hapus sebelum go-live", href: "/catalog" });
    expect(goLiveIssueLine({ code: "price_list_missing", brand: "imperial_indopack" }, t)).toEqual({ text: "Daftar harga Imperial Indopack belum diunggah", href: "/catalog" });
    expect(goLiveIssueLine({ code: "price_list_missing", brand: "kertas_supreme" }, makeT("en"))?.text).toBe("Kertas Supreme price list not uploaded");
  });

  it("a code this dashboard does not know yet gets no line, rather than a broken one", () => {
    expect(goLiveIssueLine({ code: "something_new" } as unknown as GoLiveIssue, t)).toBeNull();
    expect(goLiveIssueLine({ code: "price_list_missing", brand: "lainnya" } as unknown as GoLiveIssue, t)).toBeNull();
  });
});
