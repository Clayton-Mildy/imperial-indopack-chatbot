# Dashboard smoke checklist (Plan 2 Task 24)

- **Date:** 2026-11-19, 13:07–13:55 WIB
- **SHA:** run started on `55c2f8c` and ended on `c390dc2`. Other agents committed "Final review fix" changes during the run, and the dev API reloaded on each edit.
- **Setup:** dev API on 50070 (`WHATSAPP_TRANSPORT=capture`, dev DB `imperial_indopack` with the demo "(CONTOH)" catalog and the client's real PO links). Dashboard via `npm run dev` on 40070. Browser: the built-in browser pane at 1440×900, logged in as the local seed admin.
- **Chats:** `qa:say` for 6281200007101–7104 as in the brief. Extra customer turns on 7102 are noted at rows 5 and 12. 7105 and 7106 were used to retry row 41 on the WhatsApp path; both turns were lost to API reloads.
- **Downloads (rows 18, 29):** checked by fetching the exact URL the link points to, in the page and with curl against the API, then reading the workbook. The browser download itself was not triggered.
- **Test data removed afterwards:** the `__smoke__` product (row 36), its 3 photo files, the smoke price-list PDF, and the temporary agent account (row 45). Bot name and greeting were set back to `Admin` and the default greeting. Both PO links were never changed.

| # | Page | Result | Note |
|---|---|---|---|
| 1 | Sidebar | Pass | |
| 2 | Header ID→EN→ID | Pass | |
| 3 | Percakapan | Pass | 4 chats, `Perlu Tim · 3` |
| 4 | Search `07102` | Pass | |
| 5 | 22x22x7 chat | Pass | The first bot turn did not hand off (`not_in_catalog`, but it offered 22x22x8). It handed off after the customer insisted. QA finding F1. |
| 6 | Catatan tim | Pass | |
| 7 | Kirim daftar harga, no price list | Pass | `NO_PRICE_LIST` copy shown. Capture log and status unchanged. |
| 8 | Kirim form PO, placeholder | Covered by tests | `api/tests/quick-send.test.ts` (409 `PO_FORM_PLACEHOLDER`). The dashboard copy exists in id/en. |
| 9 | Staff reply | Pass | |
| 10 | ← Kembalikan ke AI | Pass | |
| 11 | Selesaikan courier chat | Pass | |
| 12 | Perlu Tim | Pass | Row 10 had returned the 22x22x7 chat to AI. A third customer turn re-escalated it as Harga custom. |
| 13 | Ditangani saya | Pass | 0 chats at first. After Ambil alih on the complaint chat, only that chat (Admin). |
| 14 | Ringkasan, Merek = Kertas Supreme | Pass | Checked after the lead pass tagged brands. Belum dibalas listed 07102 while it waited (13:15). |
| 15 | Leads | Pass | |
| 16 | Tab Imperial Indopack | Pass | |
| 17 | Search `22x22` | Pass | |
| 18 | Export Excel | Pass | `leads-imperial-indopack-2026-11-19.xlsx` has Merek, Barang, Nama, Usaha |
| 19 | Bukan Lead → Jadikan Lead | Pass | |
| 20 | Lead detail | Pass | |
| 21 | Ubah items | Pass | Shows `2.500 pcs (5 rim)` |
| 22 | Status → Menang | Pass | Riwayat: `Dihubungi → Menang · Staf` |
| 23 | Katalog | Pass | |
| 24 | Unggah PDF (Kertas Supreme) | Pass | |
| 25 | Cek harga 12 rim | Pass | Tier 10 rim, Rp 111.000/rim, total Rp 1.332.000. Test Prompt quoted the same figures. |
| 26 | Cek harga 1 rim | Pass | |
| 27 | Import header-only workbook | Pass | Preview 0 / 0 / 0. `Terapkan 0 baris` is disabled, so nothing changes. |
| 28 | Import edited copy | Pass | 1 harga diubah, 1 baris salah (`Satuan "box" tidak dikenal…`). Batal left the price at Rp 1.234. |
| 29 | template-katalog.xlsx | Pass | 13 columns |
| 30 | Tambah Produk, copy tiers | Pass | |
| 31 | Prices + 2 photos, Simpan | Pass | |
| 32 | Tiers 10 then 5 rim | Pass | The ✕ line shows the tier-order error ("Harus lebih besar dari tingkat di atasnya…"), as Task 18 specifies. Simpan is disabled. |
| 33 | Ubah one price | Pass | |
| 34 | 4th photo | Pass | The page shows the max-3 copy. The API also returns 409 `REFERENCE_IMAGE_LIMIT`. |
| 35 | Nonaktifkan | Pass | |
| 36 | Hapus permanen | Pass | |
| 37 | Pengaturan go-live banner | Pass | Shows WhatsApp not connected, demo catalog, and the Imperial Indopack price list missing. No PO lines. |
| 38 | PO link `http://x.y` | Pass | Refused with the https copy. The existing cetak link was re-saved unchanged (`Tersimpan`). |
| 39 | Nama bot Sari + greeting | Pass | |
| 40 | Reopen / silence / reminder / minimum | Pass | Also changed to 4 / 31 and back to 3 / 30 so the saves really ran. |
| 41 | Test Prompt | **Fail** | The price was right (attempt 1), but neither price-question attempt introduced itself as Sari. A greeting-first message did ("Halo kak, saya Sari dari Kertas Supreme"), so the setting reaches the bot. Bot behaviour, QA finding F2. |
| 42 | Kirim form PO (real link) | Pass | Dialog preselected Form cetak (design: ada). Captured: `…isi form PO berikut ya kak 🙏\nhttps://forms.gle/mybbNDzzfEETKP9h9` |
| 43 | Nomor WhatsApp | Pass | Add and edit forms opened and accepted typing. Both were cancelled. |
| 44 | Aktivitas | Pass | |
| 45 | Agent account | Pass | The browser pane has no private window, so I logged out and in as the agent. Direct URLs redirect to /conversations. |
| 46 | Kirim daftar harga on 07101 | Pass | Brand picker: Kertas Supreme. Document bubble from Admin, pill `Ditangani tim · Admin`, document line in the capture log. |

## Fix made during the run

- `dashboard/components/catalog/ProductForm.tsx` (seen at rows 34–36): the hidden photo file input is `position: absolute` but had no positioned ancestor inside the scrolling `<main>`. That made the page itself 236 px taller than the window: `scrollHeight` was 1136 against a 900 px window. Scrolling the input into view moved the whole layout, sidebar included. The photo card now has `position: relative`. Checked again: `scrollHeight == innerHeight`, and the page does not scroll.
