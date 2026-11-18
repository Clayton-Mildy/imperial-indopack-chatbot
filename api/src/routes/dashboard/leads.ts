import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import {
  AddCampaignBodySchema,
  LeadReportQuerySchema,
  LeadsExportQuerySchema,
  LeadsQuerySchema,
  LeadsSummaryQuerySchema,
  PatchLeadBodySchema,
} from '../../domain/schemas.js';
import {
  listLeads,
  getCampaignSummary,
  patchLead,
  LEAD_ALREADY_OPEN,
  upsertLeadFromImport,
  getLeadWithContact,
  getLeadById,
  listLeadOrders,
} from '../../repositories/leads.js';
import { getLeadReport } from '../../repositories/leadReport.js';
import { listLeadEvents } from '../../repositories/leadEvents.js';
import { importLeadsFromXlsx, InvalidXlsxError } from '../../services/leadImport.js';
import { buildLeadsWorkbook } from '../../services/leadsExport.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers send this for .xlsx
]);
const XLSX_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function leadRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/leads — the CRM list
  app.get('/api/v1/leads', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const query = LeadsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const { page, limit } = query.data;
    const result = await listLeads(query.data);

    return reply.send({
      data: result.items,
      error: null,
      meta: { page, total: result.total, limit },
    });
  });

  // GET /api/v1/leads/summary — per-campaign performance for the report block
  app.get('/api/v1/leads/summary', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const query = LeadsSummaryQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    return reply.send({ data: await getCampaignSummary(query.data), error: null });
  });

  // GET /api/v1/leads/report - the numbers behind the daily "Ringkasan" page, in one call.
  // Registered before /:id so "report" is never read as a lead id.
  app.get('/api/v1/leads/report', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const query = LeadReportQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }
    return reply.send({ data: await getLeadReport(query.data), error: null });
  });

  // GET /api/v1/leads/export - the filtered list as .xlsx.
  // Binary, so no { data, error } envelope. Registered before /:id-style routes for the
  // same reason /summary is: "export" must not be read as a lead id.
  app.get('/api/v1/leads/export', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const query = LeadsExportQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const workbook = await buildLeadsWorkbook(query.data);
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="leads-imperial-indopack-${date}.xlsx"`)
      .send(workbook);
  });

  // PATCH /api/v1/leads/:id — the CRM edit: pipeline status and the manual deal value
  // GET /api/v1/leads/:id - one lead with its history and the lead it replaced.
  // After the static /summary and /export routes, so those words are never read as an id.
  app.get<{ Params: { id: string } }>('/api/v1/leads/:id', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const { id } = request.params;
    const lead = UUID_RE.test(id) ? await getLeadWithContact(id) : null;
    if (!lead) {
      return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    }
    const [events, previousLead, orders] = await Promise.all([
      listLeadEvents(lead.id),
      lead.previousLeadId ? getLeadById(lead.previousLeadId) : Promise.resolve(null),
      listLeadOrders(lead.id),
    ]);
    return reply.send({ data: { lead, events, previousLead, orders }, error: null });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/v1/leads/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const body = PatchLeadBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const updated = await patchLead(request.params.id, body.data);
      if (!updated) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }
      if (updated === LEAD_ALREADY_OPEN) {
        return reply.code(409).send({ data: null, error: LEAD_ALREADY_OPEN });
      }

      return reply.send({ data: updated, error: null });
    }
  );

  // POST /api/v1/leads/campaign — one campaign row typed by hand in the dashboard modal.
  // Same writer as the Excel import, so adding a campaign before or after the customer
  // chats behaves identically, and re-adding it is a no-op rather than a duplicate.
  app.post('/api/v1/leads/campaign', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const body = AddCampaignBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const saved = await upsertLeadFromImport(body.data);
    if (!saved) {
      return reply.code(500).send({ data: null, error: 'SAVE_FAILED' });
    }

    return reply.code(201).send({ data: saved, error: null });
  });

  // POST /api/v1/leads/import — marketing's form export, the only source of UTM data
  app.post('/api/v1/leads/import', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.code(400).send({ data: null, error: 'NO_FILE' });
    }

    if (!XLSX_MIME_TYPES.has(data.mimetype) && !data.filename.toLowerCase().endsWith('.xlsx')) {
      await data.toBuffer().catch(() => {});
      return reply.code(400).send({ data: null, error: 'UNSUPPORTED_MIME_TYPE' });
    }

    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('limit')) {
        return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
      }
      throw err;
    }

    if (buffer.byteLength > XLSX_MAX_BYTES) {
      return reply.code(413).send({ data: null, error: 'FILE_TOO_LARGE' });
    }

    try {
      return reply.send({ data: await importLeadsFromXlsx(buffer), error: null });
    } catch (err: unknown) {
      // Only a genuinely unreadable workbook is the uploader's problem. Anything else (a
      // dead DB, a bug) must stay a 500 — telling someone their file is corrupt when it
      // isn't sends them off fixing the wrong thing.
      if (err instanceof InvalidXlsxError) {
        request.log.warn({ err }, '[leads] import: unreadable workbook');
        return reply.code(400).send({ data: null, error: 'INVALID_XLSX' });
      }
      throw err;
    }
  });
}
