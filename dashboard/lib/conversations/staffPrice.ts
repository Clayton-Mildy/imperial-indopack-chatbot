import type { Message } from "@/types/api";

// Before staff hand a chat back to the bot, check whether the newest price in the chat came from
// staff (a negotiated figure the bot knows nothing about). Pure and client-safe.

const UNIT = "pcs|pc|lembar|lbr|rim|box|dus|biji|buah|unit|pack|karton|ctn|kg|gr|gram";
const PRICE_UNIT = "pcs|pc|lembar|lbr|rim|box|dus|biji|buah|unit|pack|karton|ctn|kg";

const RP = /\brp\.?\s*\d/i;
const INFORMAL = new RegExp(`\\d(?:[.,]\\d+)?\\s*(?:rb|ribu|k|jt|juta)\\b(?!\\s*(?:${UNIT})\\b)`, "i");
const PER_UNIT = new RegExp(`\\d{1,3}(?:[.,]\\d{3})+\\s*(?:/|per\\s+)\\s*(?:${PRICE_UNIT})\\b`, "i");
// "harga 4.500.000 ya", "jadi 4500000 aja" - a price word, then a figure of 1.000 or more (same rule as the API's staffPrice).
const AFTER_WORD = new RegExp(`\\b(?:harga(?:nya)?|jadi|jd|total(?:nya)?|deal|nego|diskon|bulet\\w*|bulat\\w*|cuma|hanya)\\b[^\\d\\n]{0,12}(?:\\d{1,3}(?:[.,]\\d{3})+|\\d{4,9})\\b(?![.,]\\d)(?!\\s*(?:${UNIT})\\b)`, "i");

/** Does this text name a price ("Rp 4.500.000", "3 juta", "1.234/pcs")? A quantity ("10 ribu pcs") is not a price. */
export function namesPrice(text: string): boolean {
  return RP.test(text) || INFORMAL.test(text) || PER_UNIT.test(text) || AFTER_WORD.test(text);
}

/**
 * The staff message to warn about, or null. Walks newest to oldest to the latest assistant message
 * that names a price: staff-written (senderName set) -> that message; bot-written or none -> null.
 */
export function staffPriceAfterBotQuote(
  messages: Pick<Message, "role" | "body" | "senderName">[],
): Pick<Message, "role" | "body" | "senderName"> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || !namesPrice(m.body ?? "")) continue;
    return m.senderName ? m : null;
  }
  return null;
}

/** First ~80 characters of a message for the warning, single-lined. */
export function quoteSnippet(body: string, max = 80): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
