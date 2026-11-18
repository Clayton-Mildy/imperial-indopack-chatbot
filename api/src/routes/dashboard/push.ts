import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiKeyAuth } from '../../middleware/apiKey.js';
import { getConfig } from '../../config.js';
import { upsertPushSubscription, deletePushSubscription } from '../../repositories/pushSubscriptions.js';

// The shape the browser's PushManager.subscribe() hands back, narrowed to what we store.
const SubscribeBodySchema = z.object({
  staffId: z.string().uuid(),
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

const UnsubscribeBodySchema = z.object({ endpoint: z.string().url() });

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // The browser needs the VAPID public key to subscribe. Served rather than baked into the
  // dashboard build so the keypair lives in exactly one place (the API's .env) - a second copy
  // in NEXT_PUBLIC_* would silently drift on rotation and break every new subscription.
  // Empty string is a valid answer: it means push is not configured, and the dashboard hides
  // the enable button instead of offering something that cannot work.
  app.get('/api/v1/push/public-key', { preHandler: [apiKeyAuth] }, async (_request, reply) =>
    reply.send({ data: { publicKey: getConfig().VAPID_PUBLIC_KEY }, error: null })
  );

  app.post('/api/v1/push/subscribe', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const body = SubscribeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    const { staffId, endpoint, keys } = body.data;
    await upsertPushSubscription({ staffId, endpoint, p256dh: keys.p256dh, auth: keys.auth });
    return reply.send({ data: { subscribed: true }, error: null });
  });

  // Keyed on endpoint, not staff: a staff member turning notifications off on their phone must
  // not silence the desktop they left logged in at the office.
  app.delete('/api/v1/push/subscribe', { preHandler: [apiKeyAuth] }, async (request, reply) => {
    const body = UnsubscribeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    }

    await deletePushSubscription(body.data.endpoint);
    return reply.send({ data: { subscribed: false }, error: null });
  });
}
