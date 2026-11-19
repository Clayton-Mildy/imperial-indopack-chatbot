import { describe, expect, it } from "vitest";
import {
  copyTiersToOtherSizes,
  describeChange,
  displaySize,
  emptyForm,
  formErrors,
  fromCatalogProduct,
  isJpgOrPng,
  nextTierRow,
  parseQty,
  parseRupiah,
  previousPrice,
  sizeChange,
  toDraft,
  type ProductFormState,
  type TierRow,
} from "@/lib/catalog/productForm";
import { makeT } from "@/lib/i18n/core";
import type { CatalogProduct } from "@/types/api";

const T_ID = makeT("id");

const tier = (minQty: string, price: string, qtyUnit: "rim" | "pcs" = "rim", priceUnit: "rim" | "pcs" = "rim"): TierRow => ({
  minQty,
  qtyUnit,
  price,
  priceUnit,
  includesDelivery: false,
});

const base = (sizes: ProductFormState["sizes"]): ProductFormState => ({
  brand: "kertas_supreme",
  name: "Kertas Contoh 64 gsm",
  gsm: "64 gsm",
  print: "1 warna",
  finishing: "",
  use: "bungkus nasi",
  isActive: true,
  sizes,
});

const FORM_30_THREE_TIERS_AND_35_WITH_5RIM_245000 = base([
  { size: "30 x 30 cm", tiers: [tier("5", "185.000"), tier("10", "165.000"), tier("20", "160.000")] },
  { size: "35 x 35 cm", tiers: [tier("5", "245.000")] },
]);

const FORM_WITH_EMPTY_PRICE = base([
  { size: "30 x 30 cm", tiers: [tier("5", "185.000")] },
  { size: "35 x 35 cm", tiers: [tier("5", "")] },
]);

const PRODUCT: CatalogProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  brand: "imperial_indopack",
  name: "Box Contoh Ivory",
  gsm: "270 gsm",
  print: null,
  finishing: "Non laminasi",
  use: "box kue",
  isActive: true,
  sizes: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      size: "21 x 14 x 5 cm",
      tiers: [
        { minQty: 5, qtyUnit: "rim", priceIdr: 1900, priceUnit: "pcs", includesDelivery: true, note: null },
        { minQty: 2500, qtyUnit: "pcs", priceIdr: 1500, priceUnit: "pcs", includesDelivery: false, note: "Contoh catatan" },
      ],
    },
  ],
  referenceImages: [],
  updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("parseRupiah", () => {
  it.each([["185.000", 185000], ["Rp 1.450", 1450], ["1450", 1450], ["", null], ["abc", null], ["0", null]])("parseRupiah(%s)", (s, n) =>
    expect(parseRupiah(s)).toBe(n)
  );

  // Plan Review Focus #3: rupiah typed the Indonesian way. A dot groups thousands, never a decimal point.
  it.each([
    ["1.450", 1450],
    ["Rp 185.000", 185000],
    ["185000", 185000],
    ["Rp185.000", 185000],
    ["Rp. 185.000", 185000],
    ["rp 1.000.000", 1000000],
    ["Rp 185.000,-", 185000],
    ["185.000,00", 185000],
    [" 1450 ", 1450],
  ])("reads %s as %d", (s, n) => expect(parseRupiah(s)).toBe(n));

  it.each(["1.45", "1,450", "1.4500", "-5", "1.450,50", "12abc", "Rp", "000", "99999999999999999999"])("refuses %s", (s) =>
    expect(parseRupiah(s)).toBeNull()
  );
});

describe("parseQty", () => {
  it.each([["5", 5], ["2.500", 2500], ["2500", 2500], ["", null], ["abc", null], ["0", null], ["2,5", null]])("parseQty(%s)", (s, n) =>
    expect(parseQty(s)).toBe(n)
  );
});

describe("form state", () => {
  it("an empty form has one size with one 5 rim tier, priced per rim for Kertas Supreme", () => {
    const f = emptyForm("kertas_supreme");
    expect(f.sizes).toHaveLength(1);
    expect(f.sizes[0]!.tiers).toEqual([{ minQty: "5", qtyUnit: "rim", price: "", priceUnit: "rim", includesDelivery: false }]);
    expect(f).toMatchObject({ brand: "kertas_supreme", name: "", use: "", isActive: true, gsm: "", print: "", finishing: "" });
  });

  it("an empty Imperial Indopack form prices per pcs", () =>
    expect(emptyForm("imperial_indopack").sizes[0]!.tiers[0]).toMatchObject({ minQty: "5", qtyUnit: "rim", priceUnit: "pcs" }));

  it("a stored product becomes text fields, numbers written the Indonesian way", () => {
    const f = fromCatalogProduct(PRODUCT);
    expect(f).toMatchObject({ brand: "imperial_indopack", name: "Box Contoh Ivory", gsm: "270 gsm", print: "", finishing: "Non laminasi" });
    expect(f.sizes[0]!.id).toBe(PRODUCT.sizes[0]!.id);
    expect(f.sizes[0]!.tiers.map((t) => [t.minQty, t.qtyUnit, t.price, t.includesDelivery])).toEqual([
      ["5", "rim", "1.900", true],
      ["2.500", "pcs", "1.500", false],
    ]);
  });

  it("a stored product round-trips to the same draft", () => {
    const d = toDraft(fromCatalogProduct(PRODUCT));
    expect(d.sizes[0]!.tiers).toEqual(
      PRODUCT.sizes[0]!.tiers.map(({ note: _note, ...t }) => t)
    );
    expect(d.print).toBeNull();
    expect(d.sizes[0]!.id).toBe(PRODUCT.sizes[0]!.id);
  });
});

describe("toDraft", () => {
  it("draft has null for empty prices and quantities", () =>
    expect(toDraft(FORM_WITH_EMPTY_PRICE).sizes[1]!.tiers[0]).toMatchObject({ minQty: 5, priceIdr: null }));

  it("an empty quantity is null and blank spec fields are null", () => {
    const d = toDraft(base([{ size: "30 x 30 cm", tiers: [tier("", "1.450")] }]));
    expect(d.sizes[0]!.tiers[0]).toMatchObject({ minQty: null, priceIdr: 1450 });
    expect(d.finishing).toBeNull();
    expect(d.gsm).toBe("64 gsm");
  });

  it("leaves the copy marker out and keeps size ids", () => {
    const d = toDraft(base([{ id: "abc", size: "30 x 30 cm", tiers: [tier("5", "1")], copiedFrom: "x" }]));
    expect(d.sizes[0]).toEqual({ id: "abc", size: "30 x 30 cm", tiers: [expect.any(Object)] });
  });
});

describe("copyTiersToOtherSizes", () => {
  it("copies tiers, keeping matching prices and emptying the rest", () => {
    const f = copyTiersToOtherSizes(FORM_30_THREE_TIERS_AND_35_WITH_5RIM_245000, 0);
    expect(f.sizes[1]!.tiers.map((t) => [t.minQty, t.price])).toEqual([["5", "245.000"], ["10", ""], ["20", ""]]);
    expect(f.sizes[1]!.copiedFrom).toBe("30 x 30 cm");
  });

  it("leaves the source size alone and matches a quantity however it is written", () => {
    const f = copyTiersToOtherSizes(
      base([
        { size: "A", tiers: [tier("2.500", "1.000", "pcs", "pcs")] },
        { size: "B", tiers: [tier("2500", "1.200", "pcs", "pcs")] },
        { size: "C", tiers: [tier("5", "9.000", "rim", "pcs")] },
      ]),
      0
    );
    expect(f.sizes[0]).toEqual({ size: "A", tiers: [tier("2.500", "1.000", "pcs", "pcs")] });
    expect(f.sizes[1]!.tiers[0]!.price).toBe("1.200");
    // 5 rim is the same 2.500 pcs, but another (minQty, qtyUnit): its price does not carry over.
    expect(f.sizes[2]!.tiers).toEqual([tier("2.500", "", "pcs", "pcs")]);
  });
});

describe("nextTierRow", () => {
  it("doubles the top tier's quantity in the same units, price empty", () =>
    expect(nextTierRow(FORM_30_THREE_TIERS_AND_35_WITH_5RIM_245000.sizes[0]!, "kertas_supreme")).toEqual(tier("40", "")));

  it("is the brand's starting tier for a size with no tiers", () =>
    expect(nextTierRow({ size: "", tiers: [] }, "imperial_indopack")).toEqual(tier("5", "", "rim", "pcs")));

  it("goes by pcs, so 2.500 pcs above 4 rim doubles to 5.000 pcs", () =>
    expect(nextTierRow({ size: "", tiers: [tier("4", "1"), tier("2.500", "1", "pcs", "pcs")] }, "imperial_indopack")).toMatchObject({
      minQty: "5.000",
      qtyUnit: "pcs",
    }));
});

describe("formErrors", () => {
  it("a field with text that is not a number is invalid, not missing", () => {
    const f = base([{ size: "30 x 30 cm", tiers: [tier("lima", "1,45")] }]);
    const errors = formErrors(f, [
      { code: "qty_missing", sizeIndex: 0, tierIndex: 0 },
      { code: "price_missing", sizeIndex: 0, tierIndex: 0 },
    ]);
    expect(errors).toEqual([
      { code: "qty_invalid", sizeIndex: 0, tierIndex: 0 },
      { code: "price_invalid", sizeIndex: 0, tierIndex: 0 },
    ]);
  });

  it("drops a stale missing error once the field is filled, and errors that no longer point at a row", () => {
    const f = base([{ size: "30 x 30 cm", tiers: [tier("5", "1.450")] }]);
    expect(
      formErrors(f, [
        { code: "price_missing", sizeIndex: 0, tierIndex: 0 },
        { code: "name_required" },
        { code: "size_required", sizeIndex: 3 },
        { code: "tier_order", sizeIndex: 0, tierIndex: 0 },
      ])
    ).toEqual([{ code: "tier_order", sizeIndex: 0, tierIndex: 0 }]);
  });

  it("flags an unreadable number before the server has answered", () =>
    expect(formErrors(base([{ size: "30 x 30 cm", tiers: [tier("5", "1.45")] }]), [])).toEqual([
      { code: "price_invalid", sizeIndex: 0, tierIndex: 0 },
    ]));
});

describe("edit markers", () => {
  const initial = fromCatalogProduct(PRODUCT);
  const edited = (price: string): ProductFormState => ({
    ...initial,
    sizes: [{ ...initial.sizes[0]!, tiers: [initial.sizes[0]!.tiers[0]!, { ...initial.sizes[0]!.tiers[1]!, price }] }],
  });

  it("a size whose price changed is changed; a new size is new; a retyped equal price is not a change", () => {
    expect(sizeChange(edited("1.450").sizes[0]!, initial)).toBe("changed");
    expect(sizeChange(edited("1500").sizes[0]!, initial)).toBeNull();
    expect(sizeChange({ size: "10 x 10 cm", tiers: [] }, initial)).toBe("new");
  });

  it("a changed price remembers the stored one", () => {
    const f = edited("1.450");
    expect(previousPrice(f.sizes[0]!, f.sizes[0]!.tiers[1]!, initial)).toEqual({ priceIdr: 1500, priceUnit: "pcs" });
    expect(previousPrice(f.sizes[0]!, f.sizes[0]!.tiers[0]!, initial)).toBeNull();
  });
});

describe("describeChange", () => {
  it("describes a price change", () =>
    expect(
      describeChange({ kind: "tier_price", size: "21 x 14 x 5 cm", minQty: 10, qtyUnit: "rim", priceUnit: "pcs", from: 1500, to: 1450 }, T_ID)
    ).toBe("Harga 21 × 14 × 5 cm, mulai 10 rim: Rp 1.500 → Rp 1.450/pcs"));

  it.each([
    [{ kind: "created", via: "import", fileName: "contoh-katalog.xlsx" }, "Dibuat dari Import Excel (contoh-katalog.xlsx)"],
    [{ kind: "created", via: "form" }, "Dibuat lewat formulir"],
    [{ kind: "active", to: false }, "Dinonaktifkan: tidak ditawarkan bot"],
    [{ kind: "field", field: "use", from: "box kue, cookies", to: "box kue, cookies, bento kecil" }, 'Kegunaan ditambah "bento kecil"'],
    [{ kind: "field", field: "brand", from: "kertas_supreme", to: "imperial_indopack" }, "Merek: Kertas Supreme → Imperial Indopack"],
    [{ kind: "field", field: "gsm", from: null, to: "270 gsm" }, "Gramasi: — → 270 gsm"],
    [{ kind: "size_renamed", from: "21x7x5", to: "21 x 7 x 5 cm" }, "Ukuran 21 × 7 × 5 diganti jadi 21 × 7 × 5 cm"],
    [{ kind: "tier_added", size: "30 x 30 cm", minQty: 2500, qtyUnit: "pcs" }, "Tingkat mulai 2.500 pcs ditambah di 30 × 30 cm"],
    [{ kind: "delivery", size: "30 x 30 cm", minQty: 5, qtyUnit: "rim", to: true }, "Ongkir 30 × 30 cm, mulai 5 rim: jadi sudah termasuk"],
  ] as const)("%o", (c, text) => expect(describeChange(c, T_ID)).toBe(text));
});

describe("helpers", () => {
  it("writes a size with ×", () => expect(displaySize("30 x 30 cm")).toBe("30 × 30 cm"));
  it.each([
    [{ type: "image/jpeg", name: "a.jpg" }, true],
    [{ type: "image/png", name: "a.png" }, true],
    [{ type: "", name: "contoh.JPEG" }, true],
    [{ type: "image/webp", name: "a.webp" }, false],
    [{ type: "image/gif", name: "a.png" }, false],
  ])("isJpgOrPng(%o)", (file, ok) => expect(isJpgOrPng(file)).toBe(ok));
});
