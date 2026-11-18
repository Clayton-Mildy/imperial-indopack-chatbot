import 'dotenv/config';
import { getConfig } from './config.js';
import { buildApp } from './app.js';
import { startChakraSync } from './services/chakraSync.js';
import { getFullCatalogBlock } from './services/ragQuery.js';
import { warmPromptCache } from './services/aiLayer.js';
import { scheduleEscalationNudge } from './services/escalationNudge.js';
import { scheduleLeadInsights } from './services/leadInsights.js';

// Never let a log line freeze the bot. On macOS/Linux, stdout on a terminal is written
// synchronously, so a terminal nobody drains blocks the whole event loop on the next line - no
// webhook answered, no timer fired. Live 2026-09-22..24: the API ran in Conductor's run pane, the
// Mac's display went to sleep, the pane stopped being read, and replies stalled 16, 73 and 99
// minutes, each ending seconds after someone woke the screen. Async writes queue in memory instead.
// A no-op for files (NSSM on the Windows PC logs to files, which never wait on a reader).
for (const stream of [process.stdout, process.stderr]) {
  (stream as unknown as { _handle?: { setBlocking?: (blocking: boolean) => void } })._handle?.setBlocking?.(false);
}

// A stray rejection in some fire-and-forget path must not take the whole bot down with it -
// Node's default is to exit, and every webhook that lands before the restart is delivered late.
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection (kept running):', reason instanceof Error ? reason.stack : reason);
});

// Just under the prompt cache's 1h TTL, so the catalog prefix never goes cold between
// customers. A ping inside the TTL is a cheap cache read; 0 disables the schedule.
const CACHE_WARMUP_INTERVAL_MS = Number(process.env.CACHE_WARMUP_INTERVAL_MS ?? 50 * 60_000);

function scheduleCacheWarmup(): void {
  if (CACHE_WARMUP_INTERVAL_MS <= 0) return;
  void warmPromptCache(); // boot warm: first customer after a deploy hits a warm cache
  setInterval(() => { void warmPromptCache(); }, CACHE_WARMUP_INTERVAL_MS);
}

// Fills the leads list's Tipe / Hot-Cold / Minat from the chat itself (services/leadInsights.ts).
// A batch per tick, newest conversations first, so the first runs after a deploy work through the
// backlog gradually. 0 disables. One Haiku call per conversation read.
const LEAD_INSIGHTS_INTERVAL_MS = Number(process.env.LEAD_INSIGHTS_INTERVAL_MS ?? 10 * 60_000);
const LEAD_INSIGHTS_BATCH = Number(process.env.LEAD_INSIGHTS_BATCH ?? 20);

// First tick 5 minutes after boot so a reboot catches up on its own, then on the interval.
// The API is a long-lived service, so this needs no Windows Task Scheduler entry. The
// watermark makes every run after the first backfill cheap.
const FIRST_SYNC_DELAY_MS = 5 * 60_000;

function scheduleChakraSync(intervalMs: number): void {
  if (intervalMs <= 0) return;
  const tick = (): void => {
    const { started, reason } = startChakraSync();
    if (!started) console.log(`[chakraSync] scheduled run skipped: ${reason}`);
  };
  setTimeout(() => {
    tick();
    setInterval(tick, intervalMs);
  }, FIRST_SYNC_DELAY_MS);
}

async function main() {
  // Validate env on boot — throws if invalid
  const config = getConfig();

  const app = buildApp();

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`imperial-indopack-api listening on port ${config.PORT}`);
    scheduleChakraSync(config.CHAKRA_SYNC_INTERVAL_MS);
    scheduleEscalationNudge(config.ESCALATION_NUDGE_AFTER_MS, config.ESCALATION_NUDGE_INTERVAL_MS);
    scheduleLeadInsights(LEAD_INSIGHTS_INTERVAL_MS, LEAD_INSIGHTS_BATCH);
    // Warm the catalog block so the first customer after a restart doesn't pay the rebuild
    // (also covers FULL_CATALOG=0 / dev, where the prompt-cache warmup below is a no-op).
    getFullCatalogBlock().catch((err) => console.error('[index] catalog warm-up failed:', err));
    scheduleCacheWarmup();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
