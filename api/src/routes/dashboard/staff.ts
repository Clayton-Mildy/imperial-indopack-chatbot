import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { z } from 'zod';
import { CreateStaffBodySchema, PatchStaffBodySchema } from '../../domain/schemas.js';
import type { StaffProfilePublic, StaffRole } from '../../domain/types.js';
import {
  listStaff,
  findStaffById,
  createStaff,
  updateStaff,
  changeStaffPassword,
  deleteStaff,
  setStaffLanguage,
} from '../../repositories/staff.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPublic(staff: {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
  language: 'id' | 'en';
  createdAt: Date;
}): StaffProfilePublic {
  return {
    id: staff.id,
    email: staff.email,
    displayName: staff.displayName,
    role: staff.role,
    isActive: staff.isActive,
    language: staff.language,
    createdAt: staff.createdAt,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PatchLanguageBodySchema = z.object({ language: z.enum(['id', 'en']) });

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function staffRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/staff — list all staff
  app.get(
    '/api/v1/staff',
    { preHandler: [apiKeyAuth] },
    async (_request, reply) => {
      const staff = await listStaff();
      return reply.send({ data: staff.map(toPublic), error: null });
    }
  );

  // POST /api/v1/staff — create staff
  app.post(
    '/api/v1/staff',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const result = CreateStaffBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      try {
        const staff = await createStaff(result.data);
        return reply.code(201).send({ data: toPublic(staff), error: null });
      } catch (err: unknown) {
        // Unique constraint violation on email
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('unique') || msg.includes('duplicate')) {
          return reply.code(409).send({ data: null, error: 'EMAIL_ALREADY_EXISTS' });
        }
        throw err;
      }
    }
  );

  // GET /api/v1/staff/:id — get single staff member
  app.get(
    '/api/v1/staff/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const staff = await findStaffById(id);
      if (!staff) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }
      return reply.send({ data: toPublic(staff), error: null });
    }
  );

  // PATCH /api/v1/staff/:id — update staff / toggle active / change password
  app.patch(
    '/api/v1/staff/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = PatchStaffBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const { newPassword, ...fields } = result.data;

      // If nothing at all was provided, return 400
      if (Object.keys(result.data).length === 0) {
        return reply.code(400).send({ data: null, error: 'NO_FIELDS_PROVIDED' });
      }

      // Apply password change first if requested
      if (newPassword) {
        const exists = await findStaffById(id);
        if (!exists) {
          return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
        }
        await changeStaffPassword(id, newPassword);
      }

      // Apply other field updates
      let updated;
      try {
        updated = await updateStaff(id, fields);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('unique') || msg.includes('duplicate') || (err as { code?: string }).code === '23505') {
          return reply.code(409).send({ data: null, error: 'EMAIL_ALREADY_EXISTS' });
        }
        throw err;
      }
      if (!updated) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      return reply.send({ data: toPublic(updated), error: null });
    }
  );

  // PATCH /api/v1/staff/:id/language - a person's dashboard language
  app.patch(
    '/api/v1/staff/:id/language',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = PatchLanguageBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }
      if (!UUID_RE.test(id)) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }
      const updated = await setStaffLanguage(id, result.data.language);
      if (!updated) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }
      return reply.send({ data: toPublic(updated), error: null });
    }
  );

  // DELETE /api/v1/staff/:id — delete staff (cannot delete own account)
  app.delete(
    '/api/v1/staff/:id',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const deleted = await deleteStaff(id);
      if (!deleted) {
        return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
      }

      return reply.code(200).send({ data: { id }, error: null });
    }
  );
}
