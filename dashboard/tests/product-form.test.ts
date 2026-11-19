import { describe, expect, it } from "vitest";
import {
  addGramasi,
  copyTiersToOtherSizes,
  describeChange,
  displaySize,
  emptyForm,
  formErrors,
  fromCatalogProduct,
  gramasiProblem,
  gramasiSummary,
  gramasiGroups,
  isJpgOrPng,
  nextTierRow,
  parseQty,
  parseRupiah,
  previousPrice,
  removeGramasi,
  sameGsm,
  renameGramasi,
  setFirstGramasi,
  shiftErrors,
  sizeChange,
  toDraft,
  visibleErrors,
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

// Rows written without a gramasi are a no-gramasi product's rows.
type RowIn = Omit<ProductFormState["sizes"][number], "gsm"> & { gsm?: string };
const base = (sizes: RowIn[]): ProductFormState => ({
  brand: "kertas_supreme",
  name: "Kertas Contoh",
  print: "1 warna",
  finishing: "",
  use: "bungkus nasi",
  isActive: true,
  sizes: sizes.map((s) => ({ ...s, gsm: s.gsm ?? "" })),
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
  print: null,
  finishing: "Non laminasi",
  use: "box kue",
  isActive: true,
  sizes: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      size: "21 x 14 x 5 cm",
      gsm: "270 gsm",
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
    expect(f).toMatchObject({ brand: "kertas_supreme", name: "", use: "", isActive: true, print: "", finishing: "" });
    expect(f).not.toHaveProperty("gsm");
    expect(f.sizes[0]!.gsm).toBe("");
  });

  it("an empty Imperial Indopack form prices per pcs", () =>
    expect(emptyForm("imperial_indopack").sizes[0]!.tiers[0]).toMatchObject({ minQty: "5", qtyUnit: "rim", priceUnit: "pcs" }));

  it("a stored product becomes text fields, numbers written the Indonesian way", () => {
    const f = fromCatalogProduct(PRODUCT);
    expect(f).toMatchObject({ brand: "imperial_indopack", name: "Box Contoh Ivory", print: "", finishing: "Non laminasi" });
    expect(f.sizes[0]!.gsm).toBe("270 gsm");
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
    expect(d.sizes[0]!.gsm).toBe("270 gsm");
  });
});

describe("toDraft", () => {
  it("draft has null for empty prices and quantities", () =>
    expect(toDraft(FORM_WITH_EMPTY_PRICE).sizes[1]!.tiers[0]).toMatchObject({ minQty: 5, priceIdr: null }));

  it("an empty quantity is null and blank spec fields are null", () => {
    const d = toDraft(base([{ size: "30 x 30 cm", tiers: [tier("", "1.450")] }]));
    expect(d.sizes[0]!.tiers[0]).toMatchObject({ minQty: null, priceIdr: 1450 });
    expect(d.finishing).toBeNull();
    expect(d).not.toHaveProperty("gsm");
    expect(d.sizes[0]!.gsm).toBeNull();
  });

  it("carries gramasi per size, blank as null", () => {
    const d = toDraft(base([{ size: "A", gsm: "300 gsm", tiers: [tier("5", "1")] }, { size: "A", gsm: " 350 gsm ", tiers: [tier("5", "1")] }]));
    expect(d.sizes.map((x) => x.gsm)).toEqual(["300 gsm", "350 gsm"]);
  });

  it("leaves the copy marker out and keeps size ids", () => {
    const d = toDraft(base([{ id: "abc", size: "30 x 30 cm", tiers: [tier("5", "1")], copiedFrom: "x" }]));
    expect(d.sizes[0]).toEqual({ id: "abc", size: "30 x 30 cm", gsm: null, tiers: [expect.any(Object)] });
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
    expect(f.sizes[0]).toEqual({ size: "A", gsm: "", tiers: [tier("2.500", "1.000", "pcs", "pcs")] });
    expect(f.sizes[1]!.tiers[0]!.price).toBe("1.200");
    // 5 rim is the same 2.500 pcs, but another (minQty, qtyUnit): its price does not carry over.
    expect(f.sizes[2]!.tiers).toEqual([tier("2.500", "", "pcs", "pcs")]);
  });
});

describe("copyTiersToOtherSizes with gramasi", () => {
  it("stays within the source size's gramasi", () => {
    const g = gsmForm(); // [350 30x30, 300 30x30, 300 35x35]
    const f = copyTiersToOtherSizes(g, 1);
    expect(f.sizes[0]).toEqual(g.sizes[0]); // the 350 size is untouched
    expect(f.sizes[1]).toEqual(g.sizes[1]);
    expect(f.sizes[2]!.copiedFrom).toBe("30 x 30 cm");
    expect(f.sizes[2]!.tiers.map((t) => t.minQty)).toEqual(["5", "10"]);
    expect(f.sizes.every((s, i) => i === 2 || s === g.sizes[i] || sameGsm(s.gsm, "300 gsm"))).toBe(true);
  });
});

describe("nextTierRow", () => {
  it("doubles the top tier's quantity in the same units, price empty", () =>
    expect(nextTierRow(FORM_30_THREE_TIERS_AND_35_WITH_5RIM_245000.sizes[0]!, "kertas_supreme")).toEqual(tier("40", "")));

  it("is the brand's starting tier for a size with no tiers", () =>
    expect(nextTierRow({ size: "", gsm: "", tiers: [] }, "imperial_indopack")).toEqual(tier("5", "", "rim", "pcs")));

  it("goes by pcs, so 2.500 pcs above 4 rim doubles to 5.000 pcs", () =>
    expect(nextTierRow({ size: "", gsm: "", tiers: [tier("4", "1"), tier("2.500", "1", "pcs", "pcs")] }, "imperial_indopack")).toMatchObject({
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

  it("judges a blank form itself, without any API answer", () =>
    expect(formErrors(emptyForm("kertas_supreme"), [])).toEqual([
      { code: "name_required" },
      { code: "use_required" },
      { code: "size_required", sizeIndex: 0 },
      { code: "price_missing", sizeIndex: 0, tierIndex: 0 },
    ]));

  it("needs at least one size, and a tier in every size", () => {
    expect(formErrors(base([]), [])).toEqual([{ code: "no_sizes" }]);
    expect(formErrors(base([{ size: "30 x 30 cm", tiers: [] }]), [])).toEqual([{ code: "no_tiers", sizeIndex: 0 }]);
  });

  it("holds the API's caps on quantity and price", () => {
    const f = base([
      {
        size: "30 x 30 cm",
        tiers: [tier("10.000.000", "1.000.000.000"), tier("10.000.001", "1.000.000.001", "pcs", "pcs")],
      },
    ]);
    expect(formErrors(f, [])).toEqual([
      { code: "qty_invalid", sizeIndex: 0, tierIndex: 1 },
      { code: "price_invalid", sizeIndex: 0, tierIndex: 1 },
    ]);
  });

  it("holds the API's text caps (200, Kegunaan 500)", () => {
    const long = (n: number) => "a".repeat(n);
    const f = { ...base([{ size: long(201), tiers: [tier("5", "1")] }]), name: long(201), finishing: long(201), use: long(501) };
    expect(formErrors(f, [])).toEqual([
      { code: "text_too_long", field: "name" },
      { code: "text_too_long", field: "finishing" },
      { code: "text_too_long", field: "use" },
      { code: "text_too_long", field: "size", sizeIndex: 0 },
    ]);
    expect(formErrors({ ...f, name: long(200), finishing: "", use: long(500), sizes: [{ size: long(200), gsm: "", tiers: [tier("5", "1")] }] }, [])).toEqual([]);
  });

  it("keeps the API's own judgements (duplicates, order) while their row stands", () => {
    const f = base([
      { size: "30 x 30 cm", tiers: [tier("5", "1"), tier("5", "2")] },
      { size: "30x30 cm", tiers: [tier("", "1")] },
    ]);
    expect(
      formErrors(f, [
        { code: "duplicate_tier", sizeIndex: 0, tierIndex: 1 },
        { code: "duplicate_size", sizeIndex: 1 },
        // The quantity it judged is gone now: the form's own "missing" replaces it.
        { code: "tier_order", sizeIndex: 1, tierIndex: 0 },
      ])
    ).toEqual([
      { code: "qty_missing", sizeIndex: 1, tierIndex: 0 },
      { code: "duplicate_tier", sizeIndex: 0, tierIndex: 1 },
      { code: "duplicate_size", sizeIndex: 1 },
    ]);
  });
});

describe("visibleErrors", () => {
  const errors = formErrors(
    { ...emptyForm("kertas_supreme"), sizes: [{ size: "", gsm: "", tiers: [tier("lima", "")] }] },
    []
  );

  it("an untouched empty field is not marked; a wrong value always is", () =>
    expect(visibleErrors(errors, [], false)).toEqual([{ code: "qty_invalid", sizeIndex: 0, tierIndex: 0 }]));

  it("a touched field shows its missing value", () =>
    expect(visibleErrors(errors, [{ field: "name" }, { field: "price", sizeIndex: 0, tierIndex: 0 }], false)).toEqual([
      { code: "name_required" },
      { code: "qty_invalid", sizeIndex: 0, tierIndex: 0 },
      { code: "price_missing", sizeIndex: 0, tierIndex: 0 },
    ]));

  it("after a save attempt everything shows", () => expect(visibleErrors(errors, [], true)).toEqual(errors));
});

describe("shiftErrors", () => {
  const list = [
    { code: "name_required" as const },
    { code: "size_required" as const, sizeIndex: 0 },
    { code: "price_missing" as const, sizeIndex: 1, tierIndex: 0 },
    { code: "price_missing" as const, sizeIndex: 1, tierIndex: 2 },
    { code: "duplicate_size" as const, sizeIndex: 2 },
  ];

  it("removing a size drops its entries and moves the later sizes up", () =>
    expect(shiftErrors(list, 1)).toEqual([
      { code: "name_required" },
      { code: "size_required", sizeIndex: 0 },
      { code: "duplicate_size", sizeIndex: 1 },
    ]));

  it("removing a tier drops its entries and moves the later tiers of that size up", () =>
    expect(shiftErrors(list, 1, 0)).toEqual([
      { code: "name_required" },
      { code: "size_required", sizeIndex: 0 },
      { code: "price_missing", sizeIndex: 1, tierIndex: 1 },
      { code: "duplicate_size", sizeIndex: 2 },
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
    expect(sizeChange({ size: "10 x 10 cm", gsm: "", tiers: [] }, initial)).toBe("new");
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
    // A typo fix is not an addition: no word boundary between the old text and the rest.
    [{ kind: "field", field: "use", from: "box kue, cooki", to: "box kue, cookies" }, "Kegunaan: box kue, cooki → box kue, cookies"],
    [{ kind: "field", field: "use", from: "box kue,", to: "box kue,cookies" }, 'Kegunaan ditambah "cookies"'],
    [{ kind: "field", field: "brand", from: "kertas_supreme", to: "imperial_indopack" }, "Merek: Kertas Supreme → Imperial Indopack"],
    [{ kind: "field", field: "gsm", from: null, to: "270 gsm" }, "Gramasi: — → 270 gsm"],
    [{ kind: "gsm_added", gsm: "350 gsm" }, "Gramasi 350 gsm ditambah"],
    [{ kind: "gsm_removed", gsm: "300 gsm" }, "Gramasi 300 gsm dihapus"],
    [{ kind: "gsm_renamed", from: "300 gsm", to: "310 gsm" }, "Gramasi 300 gsm diganti jadi 310 gsm"],
    [{ kind: "size_added", size: "30 x 30 cm", gsm: "300 gsm" }, "Ukuran 30 × 30 cm (300 gsm) ditambah"],
    [{ kind: "size_added", size: "30 x 30 cm", gsm: null }, "Ukuran 30 × 30 cm ditambah"],
    [{ kind: "tier_added", size: "30 x 30 cm", gsm: "350 gsm", minQty: 10, qtyUnit: "rim" }, "Tingkat mulai 10 rim ditambah di 30 × 30 cm (350 gsm)"],
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

const gsmForm = (): ProductFormState =>
  base([
    { id: "a1", size: "30 x 30 cm", gsm: "350 gsm", tiers: [tier("5", "245.000")] },
    { id: "a2", size: "30 x 30 cm", gsm: "300 gsm", tiers: [tier("5", "185.000"), tier("10", "165.000")] },
    { id: "a3", size: "35 x 35 cm", gsm: "300 gsm", tiers: [tier("5", "200.000")] },
  ]);

describe("gramasiGroups", () => {
  it("orders by number, 270 before 300, keeping each group's row indexes", () => {
    const f = base([
      { size: "A", gsm: "300 gsm", tiers: [] },
      { size: "A", gsm: "1000 gsm", tiers: [] },
      { size: "B", gsm: "300", tiers: [] },
      { size: "A", gsm: "270 gsm", tiers: [] },
    ]);
    expect(gramasiGroups(f)).toEqual([
      { gsm: "270 gsm", indexes: [3] },
      { gsm: "300 gsm", indexes: [0, 2] },
      { gsm: "1000 gsm", indexes: [1] },
    ]);
    expect(gramasiGroups(gsmForm()).map((g) => g.gsm)).toEqual(["300 gsm", "350 gsm"]);
  });

  it("a no-gramasi form is one group with gsm ''", () => {
    expect(gramasiGroups(emptyForm("kertas_supreme"))).toEqual([{ gsm: "", indexes: [0] }]);
    expect(gramasiGroups({ ...emptyForm("kertas_supreme"), sizes: [] })).toEqual([{ gsm: "", indexes: [] }]);
  });
});

describe("addGramasi", () => {
  it("copies a gramasi's sizes with quantities kept and prices emptied, marked as copied", () => {
    const f = addGramasi(gsmForm(), "400 gsm", "300 gsm");
    expect(f.sizes).toHaveLength(5);
    const added = f.sizes.slice(3);
    expect(added.map((s) => [s.id, s.size, s.gsm, s.copiedFromGramasi])).toEqual([
      [undefined, "30 x 30 cm", "400 gsm", "300 gsm"],
      [undefined, "35 x 35 cm", "400 gsm", "300 gsm"],
    ]);
    expect(added[0]!.tiers.map((t) => [t.minQty, t.qtyUnit, t.price])).toEqual([["5", "rim", ""], ["10", "rim", ""]]);
    expect(f.sizes.slice(0, 3)).toEqual(gsmForm().sizes);
  });

  it("without copyFrom adds one empty size", () => {
    const f = addGramasi(gsmForm(), "400 gsm");
    expect(f.sizes).toHaveLength(4);
    expect(f.sizes[3]).toMatchObject({ size: "", gsm: "400 gsm" });
    expect(f.sizes[3]!.tiers).toHaveLength(1);
    expect(f.sizes[3]!.tiers[0]!.price).toBe("");
  });
});

describe("setFirstGramasi / renameGramasi / removeGramasi", () => {
  it("setFirstGramasi gives every row of a no-gramasi product the gramasi", () => {
    const f = setFirstGramasi(FORM_WITH_EMPTY_PRICE, "300 gsm");
    expect(f.sizes.map((s) => s.gsm)).toEqual(["300 gsm", "300 gsm"]);
    expect(f.sizes[0]!.tiers).toEqual(FORM_WITH_EMPTY_PRICE.sizes[0]!.tiers);
  });

  it("renameGramasi changes only that gramasi's rows", () => {
    const f = renameGramasi(gsmForm(), "300 gsm", "310 gsm");
    expect(f.sizes.map((s) => s.gsm)).toEqual(["350 gsm", "310 gsm", "310 gsm"]);
    expect(f.sizes.map((s) => s.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("removeGramasi removes only its rows", () => {
    const f = removeGramasi(gsmForm(), "300 gsm");
    expect(f.sizes.map((s) => s.id)).toEqual(["a1"]);
  });
});

describe("gsm_mixed", () => {
  it("is reported at the first row whose gramasi-or-not differs from the first row", () => {
    const f = base([
      { size: "A", gsm: "300 gsm", tiers: [tier("5", "1")] },
      { size: "B", gsm: "300 gsm", tiers: [tier("5", "1")] },
      { size: "C", gsm: " ", tiers: [tier("5", "1")] },
      { size: "D", gsm: "", tiers: [tier("5", "1")] },
    ]);
    expect(formErrors(f, [])).toEqual([{ code: "gsm_mixed", sizeIndex: 2 }]);
    expect(formErrors(base([{ size: "A", tiers: [tier("5", "1")] }, { size: "B", gsm: "300", tiers: [tier("5", "1")] }]), [])).toEqual([
      { code: "gsm_mixed", sizeIndex: 1 },
    ]);
    expect(formErrors(gsmForm(), [])).toEqual([]);
  });

  it("ignores a server gsm_mixed (judged locally) and holds the gramasi text cap per size", () => {
    expect(formErrors(gsmForm(), [{ code: "gsm_mixed", sizeIndex: 1 }])).toEqual([]);
    const f = base([{ size: "A", gsm: "a".repeat(201), tiers: [tier("5", "1")] }]);
    expect(formErrors(f, [])).toEqual([{ code: "text_too_long", field: "gsm", sizeIndex: 0 }]);
  });
});

describe("gramasiProblem", () => {
  it("blocks a blank gramasi and one the product already has, however it is written", () => {
    expect(gramasiProblem(["300 gsm"], "  ")).toBe("blank");
    expect(gramasiProblem(["300 gsm"], "300")).toBe("exists");
    expect(gramasiProblem(["300 gsm"], "350")).toBeNull();
  });
});

describe("gramasiSummary", () => {
  it("lists the distinct gramasi in order with one gsm", () => {
    expect(gramasiSummary(["350 gsm", "300 gsm", "300", "270 gsm", "270 gsm"])).toBe("270 · 300 · 350 gsm");
    expect(gramasiSummary([null, ""])).toBe("");
    expect(gramasiSummary(["Art Carton"])).toBe("Art Carton");
  });
});
