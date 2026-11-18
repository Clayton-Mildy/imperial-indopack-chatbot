import * as meta from './metaClient.js';
import * as chakra from './chakraClient.js';
import * as capture from './captureClient.js';
import { getConfig } from '../config.js';
import { LEAKED_TOOL_MARKUP_RE } from '../domain/constants.js';

// Single dispatch point for outbound WhatsApp. Resolves the configured transport per call
// (no import-time side effects). Both clients share the same positional signatures.
function sender() {
  const transport = getConfig().WHATSAPP_TRANSPORT;
  if (transport === 'capture') {
    if (getConfig().NODE_ENV === 'production') throw new Error('WHATSAPP_TRANSPORT=capture is for local testing only');
    return capture;
  }
  return transport === 'meta' ? meta : chakra;
}

// Every caller wraps its send in `catch { /* ignore */ }` so a failed send can't kill the
// turn — which also threw away the provider's reason for refusing. The clients build that
// reason into the error ("Chakra API error 400: ..."), so log it here, at the one point every
// outbound message passes through, then rethrow so callers still mark the message unsent.
async function logFailure<T>(kind: string, to: string, send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (err) {
    console.error(`[whatsappSender] ${kind} to ${to} FAILED:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

/**
 * WhatsApp bold is *one* asterisk; Markdown's is two. The model writes Markdown - the prompt asks
 * for bold without ever naming a syntax - so `**Box Nasi**` shipped to customers with the asterisks
 * showing (live 2026-09-09). Fixed here rather than in the prompt because this is the one point
 * every outbound message passes through, and because a prompt rule would need a reseed to reach a
 * live number and would still only be a request.
 *
 * `[^*\n]` keeps a lone stray `**` from swallowing the rest of the message: the pair has to sit on
 * one line with no asterisk between, which is what real bold looks like.
 */
export function toWhatsAppMarkup(text: string): string {
  return dropStrayClosingQuote(text
    // Tool-call markup written into the text ('",\n<parameter name="confidence">high', UAT Run 3
    // F-29). extractFromToolInput already cuts it and keeps the fields; this covers any other path.
    .replace(LEAKED_TOOL_MARKUP_RE, '')
    // A literal backslash-n: the model double-escaped a newline inside its tool JSON, and customers
    // saw "...dibagikan.\\n\\nYang bisa..." (UAT F-13, intermittent).
    .replace(/\\n/g, '\n')
    // Same double-escaping, on quotes: 'box 20x20 \\"ivory\\"' must not reach the customer.
    .replace(/\\"/g, '"')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    // WhatsApp shows Markdown links raw: "[www.example.co.id](https://www.example.co.id)". It links
    // a bare url by itself.
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) =>
      bareHost(label) === bareHost(url) ? url : `${label} ${url}`)
    // Em/en dashes read as machine-written in a WhatsApp chat (UAT F-04), and the prompt itself is
    // full of them, so no prompt rule could win. Same line only - never join two lines.
    .replace(/[ \t]*[—–][ \t]*/g, ' - ')
    .replace(/^ - /gm, '- '));
}

const bareHost = (s: string): string => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

// The same double-escaped JSON leaves the message's own closing quote behind: '...untuk kakak."'
// (Run 2 D-07, D-11). Inch marks always follow a digit or a fraction (4", 2½"), so only the other
// quotes can pair up - an odd count of those means the last one has no partner.
const NOT_INCH_QUOTE = /(?<![\d½¼¾])"/g;

function dropStrayClosingQuote(text: string): string {
  const quotes = text.match(NOT_INCH_QUOTE)?.length ?? 0;
  return quotes % 2 === 1 ? text.replace(/(?<![\d½¼¾])"\s*$/, '') : text;
}

export function sendTextMessage(phoneNumberId: string, to: string, text: string): Promise<string> {
  const body = toWhatsAppMarkup(text);
  return logFailure('text', to, () => sender().sendTextMessage(phoneNumberId, to, body));
}

/** Resolves to the wamid ('' when the provider gave none) - store it with the row, see recordBotMedia. */
export function sendImageMessage(phoneNumberId: string, to: string, imagePath: string, caption: string): Promise<string> {
  const body = toWhatsAppMarkup(caption);
  return logFailure('image', to, () => sender().sendImageMessage(phoneNumberId, to, imagePath, body));
}

export function sendDocumentMessage(phoneNumberId: string, to: string, filePath: string, filename: string): Promise<string> {
  return logFailure('document', to, () => sender().sendDocumentMessage(phoneNumberId, to, filePath, filename));
}

export function downloadMedia(mediaId: string): Promise<{ base64: string; mimeType: string }> {
  return sender().downloadMedia(mediaId);
}
