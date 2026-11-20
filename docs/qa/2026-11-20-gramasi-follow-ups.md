# Gramasi change: follow-ups left after merge (2026-11-20)

Merged into main at e4c142b (branch catalog/gramasi-options, 19 commits). Every item below was triaged by the final review as "can wait". Nothing here changes a price or sends a PO form wrongly.

## Worth doing next
- Prompt nudge: when hitung_harga names a single gramasi (e.g. 21 x 14 x 5 cm, 270 gsm only), the bot's reply and recap should repeat it. QA 923 left it out.
- A real PO link has no once-guard, so a second agreement can send the form again (QA 913). This predates the gramasi change.
- Accept "300gr" / "300 gram" as 300 gsm (api/src/domain/gramasi.ts and the dashboard copies).
- One shared dashboard gramasi helper (it is copied in productForm.ts, leads/items.ts and PriceCheckPanel).

## Deferred small items, as logged during the build
- Task 2: grouping key keeps non-numeric gramasi case while sameGsm lowercases ("Tebal" vs "tebal" → two file variants, one stored row) — related to T1 M6.
- Task 2: non-numeric gramasi text ("abc") accepted (follows normalizeGsm).
- Task 2: clash error row is the first surviving variant's row, not necessarily the product's first file row.
- Task 2: apply-path clash errors appended unsorted; skipped counts one per product.
- Task 2: variantRows.filter per variant O(n·m).
- Task 2: product facts recorded from a row that later fails validation.
- Task 3: duplicate check keys on lowercase gsm instead of sameGsm — use one helper everywhere.
- Task 3: test gaps — diffProduct Y→none, gramasi swap 270↔300 in one PUT, DB index never reached by the 400 test.
- Task 3: preview hides only one row for gsm_mixed.
- Task 3: price-only edit leaves a legacy Gramasi segment (moot after 0030).
- Task 4: no test that formErrors reports price_missing after addGramasi copy.
- Task 4: sameGsm not unit-tested for "300gsm"/"300 GSM"/decimals in the dashboard copy.
- Task 4: describeChange tests lack size_removed/size_renamed/delivery with gsm.
- Task 4b: fixed input ids in GramasiControls (duplicate ids when several headers rename at once); error ids not linked by aria-describedby.
- Task 4b: copyTiersToOtherSizes / renameGramasi leave a stale copiedFromGramasi banner.
- Task 4b: with no sizes left, the add panel still asks the first-gramasi question.
- Task 4b: removing a gramasi's last size via Hapus ukuran removes the gramasi without confirm.
- Task 4b: duplicate import statement in GramasiControls.tsx.
- Task 5: no test for out-of-stock / no-tier size inside a gramasi group; embedding-text change untested; gramasi-list line duplicated in embeddings.ts and seed-embeddings.ts (follows existing duplication).
- Task 6: "unchanged" single-quote test compares new vs new; pin the old literal.
- Task 6: out-of-stock chosen gramasi: readySizes not gramasi-aware (confusing guidance text).
- Task 6: priceOutcomes now one per gramasi line → a hand-off turn can be filed harga_custom/pesanan_besar because one gramasi line was not_in_catalog/above_top_tier (messageRouter.ts:388 + handoff.ts:40-41).
- Task 6: stale PRICE_TOOL_DESC/header comment; GUIDANCE_OF repeats inline strings; PriceCheckPanel sizeKey mirror comment; panel shows next tier for multi; contract test hard-codes 'gramasi'; test gaps (no_tiers line in multi, route test with gramasi, Agent-SDK multi, reply check with two gramasi lines).
- Task 7: dashboard lib/leads/items.ts gsm-in-name check is a plain substring — "30 gsm" matches inside "300 gsm" and drops the gramasi from the line; use a boundary check + test 30 vs 300.
- Task 7: leadsExport prints normalizeGsm(i.gsm) without the name-already-says-it check ("…300 gsm 300 gsm" for old items) — use gsmAfterName.
- Task 7: dashboard gsmText duplicates API normalisation; orderProfile↔gramasi circular import (safe, style).
- Task 8: dashboard has no label for source gramasi_question.
- Task 8: history read failure in gramasiAlreadyAsked swallowed silently (.catch(() => [])) — add console.warn.
- Task 8: gramasiQuestionBeforePo also writes the profile (side effect in a question-named function); sixth copy of the items-from-facts helper (reuse orderDetails itemsOf).
- Task 8: placeholder-hold, once-per-order and reset tests run on the text path only.
- Task 8: the question names the gramasi but not the product; loose product match can cause one spurious question (plan-mandated Decision 1).
- Task 8: routes/dashboard/testPrompt.ts reports sendPoForm without the guard.
- Task 9: draft-starter test updated with the script, not seen failing first. Real PO link has no once-guard (A9, pre-existing) → form sent twice in 913.
Task 9: review Approved, 0 Critical/Important. minor (deferred): draft-starter gsm-strip filter untested for a gsm only in the subtitle; a non-gsm "GR" token could be stripped; demo-catalog test startsWith match.
Fix wave re-review: all 12 findings ADDRESSED; new issues: none Critical/Important; minor (deferred): priceTool.ts:284 would print "gramasi null" for a null-gsm row on a mixed product (import forbids mixing).
- Visual V2 (minor): a new gramasi section heading shows the raw typed "350" until saved.
- Visual V3 (minor, a11y): tier price aria-labels ("Harga, 20 × 20 × 7,5 cm, tingkat 1") don't include the gramasi.
