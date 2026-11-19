import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { isPoFormPlaceholder, poFormMessage, poFormsMessage } from '../../domain/constants.js';
import { PO_FORM_KINDS, type PoFormKind } from '../../domain/poForms.js';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { getGoLiveIssues, getWhatsAppStatus } from '../../services/goLive.js';
import {
  getDefaultPromptSections,
  setDefaultPromptSections,
  getAiEnabledDefault,
  setAiEnabledDefault,
  getLeadReopenAfterDays,
  setLeadReopenAfterDays,
  getLeadSilenceLostDays,
  setLeadSilenceLostDays,
  getPoFormUrls,
  setPoFormUrl,
  getBotSettings,
  patchBotSettings,
} from '../../repositories/appSettings.js';

const PromptSectionSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
});

const PatchPromptDefaultsBodySchema = z.object({
  sections: z.array(PromptSectionSchema).min(1),
});

const PatchAiDefaultBodySchema = z.object({
  aiEnabled: z.boolean(),
});

const PatchReopenDaysBodySchema = z.object({
  days: z.number().int().min(1).max(365),
});

const PatchReopenMonthsBodySchema = z.object({
  months: z.number().int().min(1).max(12),
});

const PatchPoFormsBodySchema = z.object({
  kind: z.enum(PO_FORM_KINDS),
  url: z.string().max(2000).refine((u) => {
    try { return new URL(u).protocol === 'https:'; } catch { return false; }
  }),
});

/**
 * Both PO forms as Settings and the quick-send dialog show them: each link, whether it is still the
 * placeholder (then it is never sent), the message that form alone sends, and the one message that
 * sends both (design unknown, or staff pick "Keduanya").
 */
async function poFormsView() {
  const urls = await getPoFormUrls();
  const one = (kind: PoFormKind) => ({ url: urls[kind], isPlaceholder: isPoFormPlaceholder(urls[kind]), message: poFormMessage(urls[kind]) });
  return { cetak: one('cetak'), plano: one('plano'), both: { message: poFormsMessage(PO_FORM_KINDS, urls) } };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/settings/prompt-defaults
  app.get('/api/v1/settings/prompt-defaults', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const sections = await getDefaultPromptSections();
    return reply.send({ data: sections, error: null });
  });

  // PATCH /api/v1/settings/prompt-defaults
  app.patch('/api/v1/settings/prompt-defaults', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = PatchPromptDefaultsBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    await setDefaultPromptSections(result.data.sections);
    const sections = await getDefaultPromptSections();
    return reply.send({ data: sections, error: null });
  });

  // GET /api/v1/settings/ai-default
  app.get('/api/v1/settings/ai-default', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const aiEnabled = await getAiEnabledDefault();
    return reply.send({ data: { aiEnabled }, error: null });
  });

  // PATCH /api/v1/settings/ai-default
  app.patch('/api/v1/settings/ai-default', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = PatchAiDefaultBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    await setAiEnabledDefault(result.data.aiEnabled);
    return reply.send({ data: { aiEnabled: result.data.aiEnabled }, error: null });
  });

  // GET /api/v1/settings/lead-reopen-days
  app.get('/api/v1/settings/lead-reopen-days', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    return reply.send({ data: { days: await getLeadReopenAfterDays() }, error: null });
  });

  // PATCH /api/v1/settings/lead-reopen-days
  app.patch('/api/v1/settings/lead-reopen-days', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = PatchReopenDaysBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    await setLeadReopenAfterDays(result.data.days);
    return reply.send({ data: { days: result.data.days }, error: null });
  });

  // GET|PATCH /api/v1/settings/lead-reopen-months - the same setting in months, stored as days (x 30)
  app.get('/api/v1/settings/lead-reopen-months', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    const months = Math.max(1, Math.round((await getLeadReopenAfterDays()) / 30));
    return reply.send({ data: { months }, error: null });
  });

  app.patch('/api/v1/settings/lead-reopen-months', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = PatchReopenMonthsBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    await setLeadReopenAfterDays(result.data.months * 30);
    return reply.send({ data: { months: result.data.months }, error: null });
  });

  // GET|PATCH /api/v1/settings/po-forms - the two links the bot sends when a customer agrees to a price:
  // cetak (has a design) and plano (no design). PATCH sets one { kind, url } and answers with both.
  app.get('/api/v1/settings/po-forms', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    return reply.send({ data: await poFormsView(), error: null });
  });

  app.patch('/api/v1/settings/po-forms', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = PatchPoFormsBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    await setPoFormUrl(result.data.kind, result.data.url);
    return reply.send({ data: await poFormsView(), error: null });
  });

  // GET|PATCH /api/v1/settings/bot - name, signature, greeting, minimum order, reminder and sync interval
  app.get('/api/v1/settings/bot', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    return reply.send({ data: await getBotSettings(), error: null });
  });

  app.patch('/api/v1/settings/bot', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    try {
      return reply.send({ data: await patchBotSettings(request.body ?? {}), error: null });
    } catch (err) {
      if (err instanceof ZodError) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      throw err;
    }
  });

  // GET /api/v1/settings/whatsapp-status - is the number connected, and when did a customer last write
  app.get('/api/v1/settings/whatsapp-status', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    return reply.send({ data: await getWhatsAppStatus(), error: null });
  });

  // GET /api/v1/settings/go-live - what still blocks go-live
  app.get('/api/v1/settings/go-live', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    return reply.send({ data: { issues: await getGoLiveIssues() }, error: null });
  });

  // GET /api/v1/settings/lead-silence-days
  app.get('/api/v1/settings/lead-silence-days', { preHandler: [apiKeyAuth] }, async (_request, reply) => {
    return reply.send({ data: { days: await getLeadSilenceLostDays() }, error: null });
  });

  // PATCH /api/v1/settings/lead-silence-days
  app.patch('/api/v1/settings/lead-silence-days', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const result = PatchReopenDaysBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    await setLeadSilenceLostDays(result.data.days);
    return reply.send({ data: { days: result.data.days }, error: null });
  });
}
