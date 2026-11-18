import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import {
  getDefaultPromptSections,
  setDefaultPromptSections,
  getAiEnabledDefault,
  setAiEnabledDefault,
  getLeadReopenAfterDays,
  setLeadReopenAfterDays,
  getLeadSilenceLostDays,
  setLeadSilenceLostDays,
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
