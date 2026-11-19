/**
 * Runs the scripted customer conversations against the QA API (npm run qa:api), then writes the report.
 * Run: npm run qa:run [-- --only <id>[,<id>]]
 * The QA API must be running with the capture transport. The exit code is 1 when any check fails.
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { applyQaEnv, QA_BASE_URL, QA_CAPTURE_LOG, QA_PHONE_NUMBER_ID } from './env.js';

applyQaEnv();
const { sql } = await import('drizzle-orm');
const { randomUUID } = await import('crypto');
const { getDb } = await import('../../src/db/client.js');
const { readCaptured } = await import('../../src/services/captureClient.js');
const { runLeadInsightsPass } = await import('../../src/services/leadInsights.js');
const { closeSilentLeads, getLeadById } = await import('../../src/repositories/leads.js');
const { getContactProfile } = await import('../../src/repositories/contactProfiles.js');
const { inboundPayload, postInbound, waitForTurn } = await import('./lib.js');
const { SCENARIOS } = await import('./scenarios.js');
import type { Check } from './lib.js';
import type { CapturedMessage } from '../../src/services/captureClient.js';
import type { Conversation, Lead, Message } from '../../src/domain/types.js';
import type { ScenarioCtx } from './scenarios.js';

const logPath = resolve(QA_CAPTURE_LOG);
const db = getDb();

// ─── preconditions ─────────────────────────────────────────────────────────
{
  const key = process.env['SEED_API_KEY'] ?? '';
  let transport: unknown;
  try {
    const res = await fetch(`${QA_BASE_URL}/api/v1/settings/whatsapp-status`, { headers: { authorization: `Bearer ${key}` } });
    transport = ((await res.json()) as { data?: { transport?: string } }).data?.transport;
  } catch {
    transport = undefined;
  }
  if (transport !== 'capture') {
    console.error(`Refusing to run: ${QA_BASE_URL} is not up with the capture transport (npm run qa:api).`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? (args[onlyIdx + 1] ?? '').split(',').filter(Boolean) : null;
const selected = SCENARIOS.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => !only || only.includes(s.id));
if (only && selected.length !== only.length) {
  console.error(`Unknown scenario id in --only. Known: ${SCENARIOS.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

// ─── per-scenario context ──────────────────────────────────────────────────
interface Result { id: string; title: string; checks: Check[]; transcript: string[]; state: string[]; error?: string }

function makeCtx(customer: string, transcript: string[]): ScenarioCtx {
  const lastCapturedId = (): string | null => {
    const rows = readCaptured(logPath, { to: customer });
    return rows.length ? rows[rows.length - 1]!.id : null;
  };
  const record = (msgs: CapturedMessage[]) => {
    for (const m of msgs) {
      if (m.kind === 'text') transcript.push(`Bot: ${m.text}`);
      else if (m.kind === 'document') transcript.push(`[dokumen] ${m.filename ?? m.path}`);
      else transcript.push(`[foto] ${m.path}${m.caption ? ` (${m.caption})` : ''}`);
    }
    if (msgs.length === 0) transcript.push('(no reply)');
  };
  const send = async (payload: Parameters<typeof inboundPayload>[0], settleMs: number, timeoutMs: number, fixedWait?: boolean) => {
    const afterId = lastCapturedId();
    await postInbound(QA_BASE_URL, inboundPayload(payload));
    if (fixedWait) {
      await new Promise((r) => setTimeout(r, timeoutMs));
      const rows = readCaptured(logPath, { to: customer, ...(afterId ? { afterId } : {}) });
      record(rows);
      return rows;
    }
    const rows = await waitForTurn({ logPath, to: customer, afterId, settleMs, timeoutMs });
    record(rows);
    return rows;
  };
  const contactId = async (): Promise<string> => {
    const { rows } = await db.execute<{ id: string }>(sql`SELECT id FROM contacts WHERE wa_id = ${customer} OR wa_id = ${customer + '@s.whatsapp.net'} LIMIT 1`);
    if (!rows[0]) throw new Error(`no contact for ${customer}`);
    return rows[0].id;
  };
  const conversationId = async (): Promise<string> => {
    const { rows } = await db.execute<{ id: string }>(sql`SELECT id FROM conversations WHERE contact_id = ${await contactId()}::uuid ORDER BY created_at LIMIT 1`);
    if (!rows[0]) throw new Error(`no conversation for ${customer}`);
    return rows[0].id;
  };
  const camel = <T>(row: Record<string, unknown>): T =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase()), v])) as T;
  const leads = async (): Promise<Lead[]> => {
    const { rows } = await db.execute<{ id: string }>(sql`SELECT id FROM leads WHERE contact_id = ${await contactId()}::uuid ORDER BY created_at, id`);
    const out: Lead[] = [];
    for (const r of rows) { const l = await getLeadById(r.id); if (l) out.push(l); }
    return out;
  };

  return {
    customer,
    async say(text, o) {
      transcript.push(`> ${text}`);
      return send({ from: customer, id: `wamid.qa-${randomUUID()}`, phoneNumberId: QA_PHONE_NUMBER_ID, text, ...(o?.referral ? { referral: { headline: o.referral } } : {}) }, 8000, 240_000);
    },
    async sendImage(mediaId, caption) {
      transcript.push(`> [foto ${mediaId}]${caption ? ` ${caption}` : ''}`);
      return send({ from: customer, id: `wamid.qa-${randomUUID()}`, phoneNumberId: QA_PHONE_NUMBER_ID, image: { mediaId, ...(caption ? { caption } : {}) } }, 8000, 240_000);
    },
    async sayExpectingSilence(text) {
      transcript.push(`> ${text}`);
      return send({ from: customer, id: `wamid.qa-${randomUUID()}`, phoneNumberId: QA_PHONE_NUMBER_ID, text }, 0, 90_000, true);
    },
    async leadPass() {
      transcript.push('(lead insights pass)');
      await runLeadInsightsPass(50, { conversationIds: [await conversationId()], ignoreWatermark: true, quietMs: 0 });
    },
    async backdate(days) {
      transcript.push(`(backdated ${days} days)`);
      const cid = await contactId();
      const iv = sql`make_interval(days => ${days})`;
      await db.execute(sql`UPDATE messages SET created_at = created_at - ${iv} WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id = ${cid}::uuid)`);
      await db.execute(sql`UPDATE leads SET created_at = created_at - ${iv}, updated_at = updated_at - ${iv}, submitted_at = submitted_at - ${iv},
        first_contact_at = first_contact_at - ${iv}, closed_at = closed_at - ${iv}, matched_at = matched_at - ${iv} WHERE contact_id = ${cid}::uuid`);
      await db.execute(sql`UPDATE lead_events SET created_at = created_at - ${iv} WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = ${cid}::uuid)`);
      await db.execute(sql`UPDATE lead_orders SET created_at = created_at - ${iv} WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = ${cid}::uuid)`);
      await db.execute(sql`UPDATE conversations SET created_at = created_at - ${iv}, updated_at = updated_at - ${iv}, insights_extracted_at = insights_extracted_at - ${iv} WHERE contact_id = ${cid}::uuid`);
    },
    async silenceSweep() {
      transcript.push('(silence sweep, 30 days)');
      await closeSilentLeads(30, { contactIds: [await contactId()] });
    },
    async lead() { const all = await leads(); return all[all.length - 1] ?? null; },
    leads,
    async conversation() {
      const { rows } = await db.execute<Record<string, unknown>>(sql`SELECT * FROM conversations WHERE id = ${await conversationId()}::uuid`);
      return camel<Conversation>(rows[0]!);
    },
    async profile() { return (await getContactProfile(await contactId()))?.profile ?? {}; },
    async lastReplyRow() {
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        SELECT * FROM messages WHERE conversation_id = ${await conversationId()}::uuid AND role = 'assistant'
          AND coalesce(metadata->>'attachmentType', '') = '' ORDER BY created_at DESC, id DESC LIMIT 1`);
      return rows[0] ? camel<Message>(rows[0]) : null;
    },
  };
}

async function finalState(ctx: ScenarioCtx): Promise<string[]> {
  try {
    const lead = await ctx.lead();
    const conv = await ctx.conversation();
    return [
      `lead: status=${lead?.status ?? '-'} kind=${lead?.kind ?? '-'} brands=${JSON.stringify(lead?.brands ?? [])} items=${JSON.stringify(lead?.items ?? [])}`,
      `conversation: status=${conv.status} category=${conv.handoffCategory ?? '-'}`,
    ];
  } catch (err) {
    return [`(no state: ${err instanceof Error ? err.message : String(err)})`];
  }
}

// ─── run ───────────────────────────────────────────────────────────────────
const results: Result[] = [];
for (const { s, n } of selected) {
  const customer = `62812000070${String(n).padStart(2, '0')}`;
  const transcript: string[] = [];
  const ctx = makeCtx(customer, transcript);
  const started = Date.now();
  console.log(`\n== ${s.id} (${customer})`);
  let checks: Check[] = [];
  let error: string | undefined;
  try {
    checks = await s.run(ctx);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    checks = [{ name: 'scenario ran without error', ok: false, detail: error }];
  }
  const result: Result = { id: s.id, title: s.title, checks, transcript, state: await finalState(ctx), ...(error ? { error } : {}) };
  results.push(result);
  const failed = checks.filter((c) => !c.ok);
  console.log(`${failed.length === 0 ? 'PASS' : 'FAIL'} ${s.id} (${Math.round((Date.now() - started) / 1000)}s)`);
  for (const c of failed) console.log(`   x ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
}

// ─── report ────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.checks.every((c) => c.ok)).length;
let sha = 'unknown';
try { sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const esc = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines: string[] = [
  '# Conversation QA report',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- Git SHA: ${sha}`,
  `- Mode: USE_CLAUDE_CLI=${process.env['USE_CLAUDE_CLI']} (the real bot, capture transport, database imperial_indopack_qa)`,
  `- Result: ${passed}/${results.length} passed${only ? ` (only: ${only.join(', ')})` : ''}`,
  '',
  '| id | title | result | failed checks |',
  '|---|---|---|---|',
  ...results.map((r) => {
    const bad = r.checks.filter((c) => !c.ok);
    return `| ${r.id} | ${esc(r.title)} | ${bad.length === 0 ? 'pass' : 'FAIL'} | ${bad.map((c) => esc(c.name)).join('; ')} |`;
  }),
  '',
];
for (const r of results) {
  lines.push(`## ${r.id}`, '', r.title, '', '```', ...r.transcript, '```', '', 'Checks:', ...r.checks.map((c) => `- ${c.ok ? 'ok' : 'FAILED'}: ${c.name}${c.detail && !c.ok ? ` (${c.detail.slice(0, 300)})` : ''}`), '', 'Final state:', ...r.state.map((l) => `- ${l}`), '');
}
const reportPath = only ? resolve('logs', 'qa-report-partial.md') : resolve('..', 'docs', 'qa', 'conversation-qa-report.md');
if (!existsSync(dirname(reportPath))) mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, lines.join('\n') + '\n');
console.log(`\n${passed}/${results.length} passed. Report: ${reportPath}`);
process.exit(passed === results.length ? 0 : 1);
