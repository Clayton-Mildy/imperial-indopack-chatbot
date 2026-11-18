import type { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { VerifyCredentialsBodySchema } from '../../domain/schemas.js';
import { findStaffByEmail } from '../../repositories/staff.js';
import bcrypt from 'bcryptjs';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/auth/me — stub (not yet implemented)
  app.get(
    '/api/v1/auth/me',
    { preHandler: [apiKeyAuth] },
    async (_request, reply) => {
      return reply.code(501).send({ data: null, error: 'NOT_IMPLEMENTED' });
    }
  );

  // POST /api/v1/auth/verify-credentials
  app.post(
    '/api/v1/auth/verify-credentials',
    { preHandler: [apiKeyAuth] },
    async (request, reply) => {
      const result = VerifyCredentialsBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
      }

      const { email, password } = result.data;
      const staff = await findStaffByEmail(email);

      // isActive matters here or the Admin page's "Nonaktifkan" toggle is cosmetic - a
      // deactivated account could still sign in and keep its session.
      if (!staff || !staff.isActive) {
        return reply.code(401).send({ data: null, error: 'UNAUTHORIZED' });
      }

      const valid = await bcrypt.compare(password, staff.passwordHash);
      if (!valid) {
        return reply.code(401).send({ data: null, error: 'UNAUTHORIZED' });
      }

      return reply.send({
        data: {
          id: staff.id,
          email: staff.email,
          displayName: staff.displayName,
          role: staff.role,
          language: staff.language,
        },
        error: null,
      });
    }
  );
}
