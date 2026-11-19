import 'dotenv/config';

/** The QA database URL, or exit 1. Must end in _qa and never match /legacy/i. */
export function requireQaDatabaseUrl(): string {
  const url = process.env['QA_DATABASE_URL'] ?? '';
  if (!url || !/_qa(\?.*)?$/.test(url) || /legacy/i.test(url)) {
    console.error('QA_DATABASE_URL must be set, must end in _qa and must not match /legacy/i. Refusing to start.');
    process.exit(1);
  }
  return url;
}

export const QA_PORT = 50071;
export const QA_BASE_URL = `http://localhost:${QA_PORT}`;
export const QA_PHONE_NUMBER_ID = 'local-phone-70';
export const QA_CAPTURE_LOG = 'logs/qa-capture.jsonl';
export const PO_FORM_QA_URLS = { cetak: 'https://forms.gle/qa-imperial-cetak', plano: 'https://forms.gle/qa-imperial-plano' } as const;

/** Applies the QA overlay to process.env. Call before importing anything that reads config or the DB. */
export function applyQaEnv(): void {
  const url = requireQaDatabaseUrl();
  Object.assign(process.env, {
    DATABASE_URL: url,
    PORT: String(QA_PORT),
    PUBLIC_BASE_URL: QA_BASE_URL,
    NODE_ENV: 'development',
    WHATSAPP_TRANSPORT: 'capture',
    SKIP_HMAC_IN_DEV: 'true',
    USE_CLAUDE_CLI: 'true',
    LEAD_INSIGHTS_INTERVAL_MS: '0',
    CHAKRA_SYNC_INTERVAL_MS: '0',
    ESCALATION_NUDGE_AFTER_MS: '0',
    CACHE_WARMUP_INTERVAL_MS: '0',
    TYPING_DEBOUNCE_MS: '2000',
    TYPING_DEBOUNCE_FIRST_MS: '2000',
    PHOTO_DEBOUNCE_MS: '2000',
    CAPTURE_LOG_PATH: QA_CAPTURE_LOG,
    DASHBOARD_UPSTREAM: '',
  });
}
