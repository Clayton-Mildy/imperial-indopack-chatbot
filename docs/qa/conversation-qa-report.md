# Conversation QA report

- Date: 2026-11-19T07:38:24.607Z
- Git SHA: 7fd7cf9
- Mode: USE_CLAUDE_CLI=true (the real bot, capture transport, database imperial_indopack_qa)
- Result: 24/24 passed

| id | title | result | failed checks |
|---|---|---|---|
| ad_default_empty_profile | Click-to-WhatsApp ad, bare question, empty profile | pass |  |
| unsure_recommendation | Customer unsure which packaging fits | pass |  |
| full_order_quote | Full order: quote with a next-tier hint | pass |  |
| first_reply_intro | The first reply to a direct price question still greets and introduces the bot | pass |  |
| between_tiers | Box between tiers | pass |  |
| below_minimum | Below the minimum order | pass |  |
| above_top_tier | Above the top price tier goes to the team | pass |  |
| custom_size | Custom size is not in the catalog | pass |  |
| both_brands | One customer, both brands | pass |  |
| logo_image | Customer sends a logo: handed to the team for a design check | pass |  |
| no_design_reference_photos | No design yet: reference photos are sent | pass |  |
| no_design_no_photos | No design and no reference photos: the team follows up | pass |  |
| agrees_po_form | Agrees to order with a design: cetak form | pass |  |
| agrees_po_form_no_design | Agrees to order without a design: plano form | pass |  |
| price_list_no_details | Asks for the box price list | pass |  |
| courier | A courier, not a buyer | pass |  |
| supplier | A supplier offering their goods | pass |  |
| job_seeker | A job seeker | pass |  |
| complaint | A complaint goes to the team with an apology | pass |  |
| asks_human | Asks for a person | pass |  |
| english | An English-speaking customer is answered in English | pass |  |
| ack_only | A thank-you after the answer gets no reply | pass |  |
| returning_lost_after_window | A lost customer returns after the reopen window | pass |  |
| silence_lost | Silence for 31 days closes the lead as lost | pass |  |

## ad_default_empty_profile

Click-to-WhatsApp ad, bare question, empty profile

```
> berapa harga kertas supreme?
Bot: Halo kak, terima kasih sudah menghubungi Kertas Supreme 😊 Saya kirimkan daftar harganya. Sebelumnya, dengan siapa saya terhubung, dan untuk produk apa?
[dokumen] Daftar Harga Kertas Supreme (QA).pdf
```

Checks:
- ok: the bot answered
- ok: one document named the Kertas Supreme price list
- ok: no Imperial document
- ok: no rupiah figure in any reply
- ok: the reply asks a question
- ok: lead source is ad

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## unsure_recommendation

Customer unsure which packaging fits

```
> kak saya jualan nasi padang, cocoknya pakai kemasan apa ya?
Bot: Halo kak, terima kasih sudah menghubungi Kertas Supreme 😊 Untuk nasi padang, biasanya pakai kertas bungkus cetak logo - kami punya Kertas Supreme 64 gsm yang cocok banget, logo usaha kak bisa dicetak berulang di seluruh lembarnya. Kalau makanannya lumayan berminyak, ada juga Greaseproof yang tahan minyak. Sebelumnya, dengan siapa saya terhubung?
```

Checks:
- ok: the bot answered
- ok: recommends Kertas Supreme or greaseproof
- ok: no rupiah figure in any reply

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## full_order_quote

Full order: quote with a next-tier hint

```
> halo kak saya Budi dari RM Siang Contoh
Bot: Halo Kak Budi, terima kasih sudah menghubungi Imperial Indopack & Kertas Supreme 😊 Boleh tahu kemasan-nya untuk produk apa di RM-nya?
> mau kertas supreme 64 gsm cetak 1 warna 30x30, 12 rim, logo sudah ada
Bot: Baik Kak Budi, sudah saya catat pesananmu ya 😊

*Kertas Supreme 64 gsm cetak 1 warna, ukuran 30 x 30 cm, 12 rim (6.000 pcs)*
Harga: Rp 165.000/rim
Total: Rp 1.980.000 (belum termasuk ongkir)

Kalau ambil 20 rim ke atas, harganya jadi Rp 160.000/rim. Tapi untuk 12 rim ini sudah fix ya.

Setuju dengan harganya?
(lead insights pass)
```

Checks:
- ok: the bot answered
- ok: mentions Rp 165.000
- ok: mentions Rp 1.980.000
- ok: mentions Rp 160.000
- ok: priceCalls[0].outcome is quote
- ok: lead brands include kertas_supreme
- ok: an item has qty 12 rim

Final state:
- lead: status=quoted kind=lead brands=["kertas_supreme"] items=[{"gsm":"64","qty":12,"size":"30x30","print":"1 warna","product":"Kertas Supreme","qty_unit":"rim","has_design":true}]
- conversation: status=active category=-

## first_reply_intro

The first reply to a direct price question still greets and introduces the bot

```
> berapa harga kertas supreme 30x30 12 rim?
Bot: Halo kak, terima kasih sudah menghubungi Kertas Supreme 😊 Untuk Kertas Supreme 64 gsm cetak 1 warna ukuran 30 x 30 cm, 12 rim: harganya Rp 165.000/rim, *total Rp 1.980.000*, belum termasuk ongkir. Kalau ambil 20 rim ke atas, harganya jadi Rp 160.000/rim. Sebelumnya, dengan siapa saya terhubung?
```

Checks:
- ok: the bot answered
- ok: the reply greets (halo / selamat)
- ok: the reply names the bot or the brand (Admin / Kertas Supreme)

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## between_tiers

Box between tiers

```
> mau box ivory 310 gsm 20x20x7,5 cm 8 rim
Bot: Halo kak, terima kasih sudah menghubungi Imperial Indopack 😊 Untuk Box Ivory 310 gsm ukuran 20 x 20 x 7,5 cm, 8 rim (4.000 pcs), harganya Rp 2.000/pcs, total *Rp 8.000.000* sudah termasuk ongkir. Kalau ambil 10 rim nanti jadi Rp 1.800/pcs.

Sebelumnya, dengan siapa saya terhubung? Dan apakah sudah ada desain atau logo-nya untuk dicetak?
```

Checks:
- ok: the bot answered
- ok: mentions Rp 2.000
- ok: mentions Rp 8.000.000
- ok: mentions Rp 1.800

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## below_minimum

Below the minimum order

```
> kertas supreme 64 gsm 30x30 3 rim berapa kak?
Bot: Halo kak, terima kasih sudah menghubungi Kertas Supreme 😊 

Untuk Kertas Supreme 64 gsm 30 x 30 cm, minimalnya 5 rim (2.500 pcs). Mau ambil 5 rim tidak?

Sebelumnya, dengan siapa saya terhubung kak?
```

Checks:
- ok: the bot answered
- ok: mentions the minimum (minim ... 5 rim)
- ok: no Rp 555.000
- ok: priceCalls[0].outcome is below_minimum
- ok: conversation not escalated

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## above_top_tier

Above the top price tier goes to the team

```
> box ivory 310 gsm 20x20x7,5 150 rim berapa?
Bot: Kita coba cek dengan tim dulu ya kak 🙏 Sambil menunggu, boleh tahu kak, kemasannya untuk produk apa? (mis. nasi, kebab, kue, katering)
```

Checks:
- ok: escalated
- ok: category pesanan_besar
- ok: no rupiah figure in any reply

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=escalated category=pesanan_besar

## custom_size

Custom size is not in the catalog

```
> box ivory 22x22x7 cm 5000 pcs, berapa?
Bot: Kita coba cek dengan tim dulu ya kak 🙏 Sambil menunggu, apakah sudah ada desain atau logo yang mau dicetak kak?
```

Checks:
- ok: escalated
- ok: category harga_custom
- ok: no rupiah figure in any reply
- ok: a reply mentions the team

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=escalated category=harga_custom

## both_brands

One customer, both brands

```
> mau kertas supreme 64 gsm 35x35 10 rim
Bot: Halo kak, terima kasih sudah menghubungi Kertas Supreme 😊 

Untuk Kertas Supreme 64 gsm cetak 1 warna ukuran 35 x 35 cm, 10 rim: harganya Rp 217.500/rim, total Rp 2.175.000 (belum termasuk ongkir). Kalau ambil 20 rim, harganya jadi Rp 207.000/rim.

Sebelumnya dengan siapa saya terhubung, dan sudah punya logo/desain untuk dicetak?
> sekalian box ivory 270 gsm 21x14x5 5000 pcs juga
Bot: Baik kak, saya catat pesanannya 😊

Kertas Supreme 64 gsm cetak 1 warna 35 x 35 cm: *10 rim Rp 217.500/rim, total Rp 2.175.000* (belum termasuk ongkir). Kalau ambil 20 rim, harganya jadi Rp 207.000/rim.

Box Ivory 270 gsm cetak full color 21 x 14 x 5 cm: *5.000 pcs Rp 1.500/pcs, total Rp 7.500.000* (sudah termasuk ongkir).

Sebelumnya, dengan siapa saya terhubung? Dan untuk logonya, sudah punya desain yang mau dicetak atau masih butuh bantuan?
(lead insights pass)
```

Checks:
- ok: the bot answered
- ok: mentions Rp 217.500
- ok: mentions Rp 2.175.000
- ok: mentions Rp 1.500
- ok: mentions Rp 7.500.000
- ok: brands include both
- ok: at least 2 items

Final state:
- lead: status=quoted kind=lead brands=["kertas_supreme","imperial_indopack"] items=[{"gsm":"64","qty":10,"size":"35x35","product":"Kertas Supreme","qty_unit":"rim"},{"gsm":"270","qty":5000,"size":"21x14x5","product":"Box Ivory","qty_unit":"pcs"}]
- conversation: status=active category=-

## logo_image

Customer sends a logo: handed to the team for a design check

```
> mau cetak kertas supreme 64 gsm 30x30 10 rim
Bot: Halo kak, terima kasih sudah menghubungi Kertas Supreme 😊

Baik, saya catat pesanannya: Kertas Supreme 64 gsm cetak 1 warna, 30 x 30 cm, 10 rim.

*Harganya Rp 165.000/rim, total Rp 1.650.000* (belum termasuk ongkir). Kalau naik ke 20 rim, harganya jadi Rp 160.000/rim.

Sebelumnya, dengan siapa saya terhubung? Dan apakah logo atau desainnya sudah ada?
> [foto logo.png] ini logonya kak
Bot: Terima kasih atas logonya kak 😊 Desainnya akan aku teruskan ke tim bersama pesanannya.

Nah, tinggal nama kak sama nama tokonya aja. Dengan siapa saya terhubung, dan apa nama usahanya?
```

Checks:
- ok: the bot answered
- ok: a reply mentions logo or desain
- ok: escalated
- ok: category desain_masuk
- ok: a profile item has has_design true

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=escalated category=desain_masuk

## no_design_reference_photos

No design yet: reference photos are sent

```
> mau kertas supreme 64 gsm cetak 1 warna 30x30 10 rim, belum punya desain. ada contohnya?
Bot: Siap kak! Contoh desainnya sudah saya kirim ya, biasanya logo dicetak berulang di seluruh lembar 😊 

Untuk 10 rim (5.000 pcs), harganya Rp 165.000/rim, jadi totalnya Rp 1.650.000 (belum termasuk ongkir). Kalau ambil 20 rim, harganya jadi Rp 160.000/rim.

Sebelumnya, dengan siapa saya terhubung? Dan produk ini untuk nasi, makanan kering, atau apa ya kak?
[foto] /uploads/images/qa-ref-1.png
[foto] /uploads/images/qa-ref-2.png
```

Checks:
- ok: 1 to 3 images captured
- ok: each image is one of the product reference photos

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## no_design_no_photos

No design and no reference photos: the team follows up

```
> mau box ivory 270 gsm 21x14x5 5000 pcs, belum ada desain, ada contoh?
Bot: Halo kak, terima kasih sudah menghubungi Imperial Indopack 😊 

Baik, untuk Box Ivory 270 gsm ukuran 21 x 14 x 5 cm sebanyak 5.000 pcs, harganya *Rp 1.500/pcs, total Rp 7.500.000* (sudah termasuk ongkir).

Untuk desain, saya catat belum ada ya. Tim kami akan kirimkan beberapa contoh desain box sesuai ukuran dan spesifikasi kalian nanti. Sebelumnya, dengan siapa saya terhubung, dan bisnis kalian di bidang apa?
Bot: Untuk contoh desainnya, tim kami kirimkan sebentar lagi ya kak 🙏
```

Checks:
- ok: no image captured
- ok: escalated
- ok: a reply mentions the team

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=escalated category=desain_masuk

## agrees_po_form

Agrees to order with a design: cetak form

```
> halo kak saya Budi dari RM Siang Contoh
Bot: Halo Kak Budi, terima kasih sudah menghubungi Imperial Indopack 😊 Boleh tahu untuk RM Siang Contoh, butuh kemasan apa ya - box atau kertas bungkus?
> mau kertas supreme 64 gsm cetak 1 warna 30x30, 12 rim, logo sudah ada
Bot: Baik Kak Budi, sudah saya catat ya. Untuk pesanan Kertas Supreme 64 gsm cetak 1 warna ukuran 30 x 30 cm sebanyak 12 rim:

*Rp 165.000/rim, total Rp 1.980.000* (belum termasuk ongkir)

Kalau ambil lebih banyak, mulai 20 rim harganya jadi Rp 160.000/rim. Sudah setuju dengan harga ini kak?
> oke kak saya ambil 12 rim
Bot: Baik Kak Budi, pesanan sudah saya catat ya 😊 

Kertas Supreme 64 gsm cetak 1 warna ukuran 30 x 30 cm, 12 rim (6.000 pcs) = *Rp 1.980.000* (belum termasuk ongkir)

Terima kasih, form pesanan akan saya kirim sekarang.
Bot: Untuk pemesanannya, silakan isi form PO berikut ya kak 🙏
https://forms.gle/qa-imperial-cetak
(lead insights pass)
```

Checks:
- ok: a text equals the cetak PO form message
- ok: lead is won

Final state:
- lead: status=won kind=lead brands=["kertas_supreme"] items=[{"gsm":"64","qty":12,"size":"30x30","print":"cetak 1 warna","product":"Kertas Supreme","qty_unit":"rim","has_design":true}]
- conversation: status=active category=-

## agrees_po_form_no_design

Agrees to order without a design: plano form

```
> halo kak saya Budi dari RM Siang Contoh
Bot: Halo kak Budi, terima kasih sudah menghubungi kami 😊 Boleh tahu untuk RM Siang Contoh butuh kemasan kertas atau box untuk produk apa ya?
> mau kertas supreme 64 gsm cetak 1 warna 30x30, 12 rim, belum punya desain
Bot: Baik Kak Budi 😊 Untuk Kertas Supreme 64 gsm cetak 1 warna ukuran 30 x 30 cm sebanyak *12 rim*, harganya Rp 165.000/rim, total Rp 1.980.000 (belum termasuk ongkir). Kalau ambil 20 rim, harganya jadi Rp 160.000/rim.

Saya kirim contoh desainnya supaya bisa lihat bagaimana tampilan cetakannya. Apa Kak Budi setuju dengan harganya?
[foto] /uploads/images/qa-ref-1.png
[foto] /uploads/images/qa-ref-2.png
> oke kak saya ambil 12 rim
Bot: Siap Kak Budi, makasih ya 😊 Jadi pesanannya Kertas Supreme 64 gsm cetak 1 warna ukuran 30 x 30 cm sebanyak 12 rim, total Rp 1.980.000 (belum termasuk ongkir). Form pesanannya akan kami kirim sekarang.
Bot: Untuk pemesanannya, silakan isi form PO berikut ya kak 🙏
https://forms.gle/qa-imperial-plano
```

Checks:
- ok: a text equals the plano PO form message

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## price_list_no_details

Asks for the box price list

```
> kak minta pricelist box nya dong
[dokumen] Daftar Harga Imperial Indopack (QA).pdf
Bot: Halo kak, terima kasih sudah menghubungi Imperial Indopack 😊 Daftar harga box kami sudah saya kirimkan ya.

Sebelumnya, dengan siapa saya terhubung? Dan box-nya untuk produk apa kak?
```

Checks:
- ok: one document named the Imperial price list
- ok: no rupiah figure in any reply

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## courier

A courier, not a buyer

```
> Paket untuk gudang Jatinegara, penerimanya siapa kak?
Bot: Baik kak, pesannya saya teruskan ke tim kami ya 🙏 Mohon ditunggu sebentar.
(lead insights pass)
```

Checks:
- ok: lead kind kurir
- ok: category bukan_pembeli
- ok: no sales questions (berapa / ukuran)
- ok: no rupiah figure in any reply

Final state:
- lead: status=new kind=kurir brands=[] items=[]
- conversation: status=escalated category=bukan_pembeli

## supplier

A supplier offering their goods

```
> Kami supplier kertas kraft roll, boleh kirim penawaran ke bagian pembelian?
Bot: Baik kak, pesannya saya teruskan ke tim kami ya 🙏 Mohon ditunggu sebentar.
(lead insights pass)
```

Checks:
- ok: lead kind supplier
- ok: category bukan_pembeli

Final state:
- lead: status=new kind=supplier brands=[] items=[]
- conversation: status=escalated category=bukan_pembeli

## job_seeker

A job seeker

```
> Permisi kak, apakah ada lowongan operator mesin cetak?
Bot: Baik kak, pesannya saya teruskan ke tim kami ya 🙏 Mohon ditunggu sebentar.
(lead insights pass)
```

Checks:
- ok: lead kind lamaran_kerja
- ok: category bukan_pembeli

Final state:
- lead: status=new kind=lamaran_kerja brands=[] items=[]
- conversation: status=escalated category=bukan_pembeli

## complaint

A complaint goes to the team with an apology

```
> Kak kertas yang saya terima kemarin sobek semua, saya kecewa
Bot: Mohon maaf ya kak atas kendalanya 🙏 Keluhannya saya teruskan ke tim kami untuk dicek.
(lead insights pass)
```

Checks:
- ok: lead kind stays lead (a complaining customer is a buyer)
- ok: escalated
- ok: category komplain
- ok: the reply apologises (maaf)
- ok: no sales questions (berapa / ukuran)

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=escalated category=komplain

## asks_human

Asks for a person

```
> bisa langsung bicara dengan orang/admin saja kak?
Bot: Kita coba cek dengan tim dulu ya kak 🙏
```

Checks:
- ok: escalated
- ok: category minta_orang
- ok: no sales questions (berapa / ukuran)

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=escalated category=minta_orang

## english

An English-speaking customer is answered in English

```
> Hi, I need Kertas Supreme 64 gsm printed 1 colour, 30x30 cm, 10 rim. How much?
Bot: Hi, thanks for reaching out to Kertas Supreme! 

For Kertas Supreme 64 gsm printed 1 color, 30x30 cm, 10 rim:
*Rp 165.000/rim, total Rp 1.650.000* (not including delivery).

If you order 20 rim or more, the price drops to Rp 160.000/rim. I've also sent you some reference design examples.

Before we proceed, who am I speaking with?
[foto] /uploads/images/qa-ref-1.png
[foto] /uploads/images/qa-ref-2.png
```

Checks:
- ok: one English reply with Rp 165.000 and Rp 1.650.000

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## ack_only

A thank-you after the answer gets no reply

```
> berapa harga kertas supreme?
Bot: Halo kak, terima kasih sudah menghubungi Kertas Supreme 😊 Kami punya beberapa pilihan kertas untuk membungkus berbagai makanan. Sebelumnya, dengan siapa saya terhubung, dan kertas-nya untuk produk apa?
[dokumen] Daftar Harga Kertas Supreme (QA).pdf
> terima kasih kak 🙏
(no reply)
```

Checks:
- ok: nothing captured for the thank-you

Final state:
- lead: status=new kind=lead brands=[] items=[]
- conversation: status=active category=-

## returning_lost_after_window

A lost customer returns after the reopen window

```
> mau kertas supreme 30x30 5 rim
Bot: Halo kak, terima kasih sudah menghubungi Kertas Supreme 😊

Untuk Kertas Supreme 30x30 cm cetak 1 warna, 5 rim harganya Rp 185.000/rim, totalnya Rp 925.000 ya (belum termasuk ongkir). Oh, kalau naik ke 10 rim, bisa dapat Rp 165.000/rim jadi lebih hemat.

Sebelumnya, dengan siapa saya terhubung? Sama, sudah ada desain logonya atau masih butuh kita bantu?
(lead insights pass)
(backdated 100 days)
> kak mau order lagi kertas supreme 30x30 10 rim
Bot: Siap kak 😊 Untuk Kertas Supreme 30x30 cm cetak 1 warna, 10 rim harganya Rp 165.000/rim, totalnya Rp 1.650.000 (belum termasuk ongkir). Kalau naik ke 20 rim, bisa dapat Rp 160.000/rim jadi lebih hemat.

Oh ya, 10 rim ini tambahan dari pesanan 5 rim sebelumnya atau penggantinya? Terus, sudah ada desain logonya atau belum kak?
(lead insights pass)
```

Checks:
- ok: the contact has 2 leads
- ok: the newest lead points at the old one
- ok: the newest lead is not lost

Final state:
- lead: status=quoted kind=lead brands=["kertas_supreme"] items=[{"qty":10,"size":"30x30","product":"Kertas Supreme","qty_unit":"rim"}]
- conversation: status=active category=-

## silence_lost

Silence for 31 days closes the lead as lost

```
> berapa harga box ivory 270 gsm 21x14x5?
Bot: Halo kak, terima kasih sudah menghubungi Imperial Indopack 😊 Untuk Box Ivory 270 gsm ukuran 21x14x5 cm, harganya mulai Rp 1.900/pcs (5 rim minimum, sudah termasuk ongkir) atau Rp 1.500/pcs kalau ambil 10 rim ke atas.

Sebelumnya, dengan siapa saya terhubung? Dan butuh berapa rim?
[dokumen] Daftar Harga Imperial Indopack (QA).pdf
(backdated 31 days)
(silence sweep, 30 days)
```

Checks:
- ok: lead is lost
- ok: reason tidak_ada_respon

Final state:
- lead: status=lost kind=lead brands=[] items=[]
- conversation: status=active category=-

