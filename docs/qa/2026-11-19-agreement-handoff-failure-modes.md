# Agreement, hand-off and bubble cases: what can go wrong (2026-11-19)

Started from the live test where the customer agreed to staff's price and never got the PO form.
Every case below was checked in the code (file:line), in the live database, or by replaying it on
the QA bot (port 50071, capture transport, synthetic customers 0812-0000-09xx). Status:

- **BUG**: the bot does something wrong to the customer.
- **GAP**: nothing handles the case.
- **OK**: checked and safe.

## What happened in the live chat

| Time | What | Evidence |
|---|---|---|
| 18:07 | Bot quotes Rp 1.234/pcs, total Rp 3.085.000 | messages |
| 18:08 | Customer asks to negotiate, and the bot hands off to the team | escalation_ack |
| 18:10:09 | Admin takes over, then sends "halo kak" | activity_logs |
| 18:10:22 | **Kembalikan ke AI** | activity_logs |
| 18:10:32 | Admin sends again, which takes the chat over again | system_note |
| 18:10:45 | **Kembalikan ke AI** again: the bot is back in charge | activity_logs |
| 18:11:12 | Staff types "buletin ke 3 juta" on the phone. It is labelled Tim CS and does not pause the bot | chakra_sync |
| 18:11:17 | Customer: "ya oke lah" | |
| 18:11:49 | Bot: "Kita coba cek dengan tim dulu" and hands off. No PO form | escalation |
| 18:12 | "ini ordernya gmn brrti ya?" gets another holding line, and its reason is on the banner | escalation_ack |

The 18:12 reason, from the reply check (the second AI that checks every reply against the catalog),
is wrong on both points:

- It calls the total Rp 3.085.000 correct, then rejects it anyway. Its own rules say totals are not
  its job (aiLayer.ts JUDGE_SYSTEM_PROMPT).
- It says "Desain sudah ada" is not supported, although the logo came in at 18:05. The check only
  sees the latest customer message, plus the bot's last message when that message is short
  (aiLayer.ts:1453). It is never given the order facts already recorded.

The 18:11 reason was overwritten (messageRouter.ts:674 refreshes it on every turn), so we cannot know
whether that turn was the check or the bot handing off by its own choice. The prompt tells it to hand
off when a customer asks about a staff price (constants.ts:340).

## A. Agreeing to buy and getting the PO form

| # | Case | Status | What happens | Evidence |
|---|---|---|---|---|
| A1 | Normal agreement, design known ("oke kak saya ambil yang itu") | OK | Recap, then the cetak form | replay: happy |
| A2 | Agreement in three quick bubbles ("oke" / "saya ambil kak" / "kirim formnya ya") | OK | One reply, the form once | replay: bubbles |
| A3 | **Staff offered a lower price, handed back, and the customer agrees** | **BUG** | The bot's draft quoted staff's 4,5 juta. The price check allows only calculator or catalog figures, so it was rejected, and the repair told the customer **Rp 5.000.000** and sent the PO form. Next turn the bot noticed the conflict and handed off. | replay: nego; replyChecks.ts verifyReplyTieredPrices; aiLayer.ts repair loop |
| A4 | Agreement whose reply the check rejects twice | **BUG** | The bot sends the canned holding line and hands off with the check's reason. The PO form flag is dropped, and the reason never says "pelanggan setuju — kirim form PO", so staff don't know a sale is waiting. | messageRouter.ts:657-700; aiLayer.ts:713 |
| A5 | The check sees only the last message | **BUG** | Recap lines (name, business, design, quantity) come from earlier in the chat, so the check can call them made up. This is the live 18:12 reason. | aiLayer.ts:1453-1462 |
| A6 | Agreement with no design on record ("oke deal kak") | **GAP** | No form. The bot asked about the design again. The form only went after "sudah ada logonya". A customer who doesn't answer never gets it, although the prompt says to send both forms when the design is unknown. | replay: nodesign, nodesign-more |
| A7 | "ini ordernya gimana ya?" right after the form was sent | **BUG** | Handed to the team as "Pelanggan bertanya status pesanan". It should be "isi form PO yang barusan dikirim ya kak". | replay: happy |
| A8 | The recap promises things the prompt forbids | **BUG** | "Pesanannya udah fix ya", "Logonya nanti langsung kami teruskan ke tim produksi" and "tinggal diisi dan dikirim balik" all passed the order-status check. | replay: nodesign-more, happy; replyChecks.ts verifyReplyOrderStatus |
| A9 | A real PO link has no once-only guard | GAP | A second "oke" on the same order can send the form again. Only the placeholder promise is guarded. | messageRouter.ts:296-334 |
| A10 | PO form while the chat is escalated | OK, by design | An escalated chat still gets normal answers and the form. Only a rejected or low-confidence turn gets the holding line. | messageRouter.ts:434, 709 |

## B. Staff and the bot

| # | Case | Status | What happens | Evidence |
|---|---|---|---|---|
| B1 | **Staff take over or send while a customer turn is already running** (AI call 10-30 s) | **BUG** | Status is read once before the AI call and never again before sending, so the bot replies over staff. A low-confidence turn even writes `escalated` over `needs_human`. | messageRouter.ts:551 (only read), 692, 715 |
| B2 | Staff reply typed on the phone (WhatsApp Business app via Chakra) | **GAP (your call)** | Only labelled "Tim CS". It does not pause the bot (a choice carried over from the source project). Sync runs about 8 s after a customer message, so a reply typed during the AI call is not seen at all. | chakraSync.ts:32-43, messageRouter.ts:550 |
| B3 | "Kembalikan ke AI" right after staff named a price or made a promise | GAP | No confirmation and no warning. Everything is reset (reason, category, assignee). Messages that came in during the hold stay unanswered until the customer writes again. | ChatPane.tsx:474; conversations.ts:408-436 |
| B4 | Customer writes while staff hold the chat | GAP | Stored, but no push and no WhatsApp notice to staff. A forgotten chat stays silent. | messageRouter.ts:553, 1273 |
| B5 | Staff send a file from the dashboard | GAP | Does not pause the bot (a typed reply and quick-send do). | routes/dashboard/attachments.ts:122 |
| B6 | Holding lines repeat | GAP | A human-request or tax turn always sends the same line. The 4-line rotation restarts after 20 messages. | messageRouter.ts:226-228 |
| B7 | Hand-offs for a total, size, PO or design get no reminder | GAP | They write no `source='escalation'` row, so the stale-escalation nudge never fires. | conversations.ts:378-395 |

## C. Several bubbles, photos and delivery

| # | Case | Status | What happens | Evidence |
|---|---|---|---|---|
| C1 | Bubbles within 8 s | OK | One reply | messageRouter.ts:37 |
| C2 | **Bubbles 10-20 s apart** (live 18:04:35 / 18:04:49) | GAP | The window runs from server arrival, and Chakra delivers 4-8 s late (a live photo took 8 s). Bubble 2 landed after reply 1 went out, so the customer got two replies. | messageRouter.ts:1409-1416 |
| C3 | A third bubble while the bot is writing | GAP | Only one merge per turn. The third bubble gets its own reply. | messageRouter.ts:459 |
| C4 | A photo arrives while text bubbles are waiting | **BUG** | The text batch is cancelled and the photo turn answers from history. The text's checks (asks for a person, complaint, price list, tax, not a buyer) never run. | messageRouter.ts:1312-1320 |
| C5 | Captionless photo the server cannot download | GAP | A canned "can't open" reply for each one, so an album of 5 gets 5 replies. Likely live: Chakra's media API 404s on newer ids until META_ACCESS_TOKEN is set. | messageRouter.ts:1389-1398 |
| C6 | Sticker, voice note or location, plus text | GAP | Two replies: the canned one and the answer. | messageRouter.ts:74 |
| C7 | Customer edits a message ("2500" → "5000") or deletes one | GAP | Ignored. The bot keeps the old text. | routes/webhooks.ts:148-158 |
| C8 | **API restart** (the live API runs `tsx watch`: every saved file under api/src restarts it) | GAP | Waiting bubbles and running turns are lost, with no reply until the customer writes again. | messageRouter.ts in-memory maps |
| C9 | The price-list PDF is asked for twice | GAP | Sent twice | catalogDelivery.ts:151 |
| C10 | Same message from the webhook and from chakraSync | OK | Deduplicated on wa_message_id, answered once | conversations.ts:467, 487 |
| C11 | A late bubble sorts before the bot reply it followed | GAP | Bot rows get now(), customer rows get the WhatsApp time | messageRouter.ts:725 |

## D. Failure paths

- Claude tokens run out: the turn is silent, and staff get one push per chat per 30 min
  (messageRouter.ts:416-432).
- An error outside the AI call (DB read, quoted-message lookup, status write) is only logged. The
  customer gets no reply and staff get no alert (messageRouter.ts:551, 588).

## Suggested fixes, in order

1. **A3 + B3:** when staff named a price after the bot's last quote, an agreement goes to the team
   ("Pelanggan setuju harga dari tim Rp …, mohon kirim form PO") with the canned PO line. The bot
   never re-quotes. Warn on "Kembalikan ke AI" when staff wrote a price.
2. **B1:** re-read the status right before every send. If staff hold the chat, send nothing and
   write no status.
3. **A4 + A5:** a rejected agreement turn says so in the hand-off reason. Give the check the recorded
   order facts, and tell it the recap (name, business, design, quantity) is not its job.
4. **A6, A7, A8:** send both forms when the design is unknown. After the form, "gimana ordernya"
   gets "silakan isi form PO yang barusan dikirim". Block "udah fix", "tim produksi" and
   "dikirim balik".
5. **C2 + C8 for the client test:** set `TYPING_DEBOUNCE_MS=15000`, and run the API with
   `npm run build && npm start` (no watch) so an edit cannot restart it mid-chat.
6. **B2:** your call whether a phone reply should pause the bot like a dashboard reply.
7. The rest (B4-B7, C3-C7, C9, C11, D) after the client test.
