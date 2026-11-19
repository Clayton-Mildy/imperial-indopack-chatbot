import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import httpProxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import { join } from 'path';
import { webhookRoutes } from './routes/webhooks.js';
import { conversationRoutes } from './routes/dashboard/conversations.js';
import { contactRoutes } from './routes/dashboard/contacts.js';
import { escalationRoutes } from './routes/dashboard/escalations.js';
import { numberRoutes } from './routes/dashboard/numbers.js';
import { catalogRoutes } from './routes/dashboard/catalog.js';
import { catalogPreviewRoutes, catalogProductRoutes } from './routes/dashboard/catalogProducts.js';
import { brandPriceListRoutes } from './routes/dashboard/brandPriceLists.js';
import { sendRoutes } from './routes/dashboard/send.js';
import { testPromptRoutes } from './routes/dashboard/testPrompt.js';
import { authRoutes } from './routes/dashboard/auth.js';
import { settingsRoutes } from './routes/dashboard/settings.js';
import { chakraSyncRoutes } from './routes/dashboard/chakraSync.js';
import { staffRoutes } from './routes/dashboard/staff.js';
import { activityLogRoutes } from './routes/dashboard/activityLogs.js';
import { attachmentRoutes } from './routes/dashboard/attachments.js';
import { uploadRoutes } from './routes/dashboard/uploads.js';
import { pushRoutes } from './routes/dashboard/push.js';
import { leadRoutes } from './routes/dashboard/leads.js';
import { teamQueueRoutes } from './routes/dashboard/teamQueue.js';

// @fastify/reply-from overwrites the outgoing Host with the upstream's (its index.js:
// `headers.host = url.host`) and sets no x-forwarded-host. Next then synthesises one from that
// rewritten Host, so it sees 127.0.0.1:40070 while the browser's Origin says the public
// hostname - and Next 16 aborts EVERY Server Action on that mismatch with "Invalid Server
// Actions request", a 500 the proxy faithfully relays. GETs are unaffected, so the whole
// dashboard reads fine and only mutations fail: creating a staff account died here on
// 2026-09-19, and it would have taken every other form with it.
//
// x-forwarded-host is supposed to carry the ORIGINAL host, which is exactly what Next wants,
// so forward it rather than widening serverActions.allowedOrigins - that would turn the CSRF
// check off instead of giving it the truth. x-forwarded-proto needs nothing: Cloudflare sends
// it and reply-from copies every header it does not rewrite.
export function forwardOriginalHost(
  originalReq: { headers: Record<string, string | string[] | undefined> },
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const host = originalReq.headers['host'];
  if (!host) return headers;
  return { ...headers, 'x-forwarded-host': host };
}

/**
 * Headers for a file served from the uploads folder, at any depth (judged by the path inside the
 * uploads folder): nosniff, and a download for anything that is not a plain photo (see the
 * fastifyStatic registration below). Customer files (inbound/) and staff attachments keep the
 * sender's file name, and on the dashboard's hostname an x.html or x.svg must never render as a page.
 * A download disposition does not stop Chakra/WhatsApp fetching a price-list PDF by its URL.
 * Both separators, for Windows.
 */
export function uploadFileHeaders(uploadsRoot: string, filePath: string): Record<string, string> {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = `${norm(uploadsRoot)}/`;
  const file = norm(filePath);
  if (!file.startsWith(root)) return {};
  return /\.(jpe?g|png|webp|gif)$/i.test(file)
    ? { 'X-Content-Type-Options': 'nosniff' }
    : { 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment' };
}

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  // Plugins
  // Registered inline, not via a wrapper plugin: a plain async function creates its own
  // encapsulation scope, so @fastify/cors's hooks would land inside it and never apply to the
  // routes registered below. In production only the dashboard's own origin is allowed
  // (DASHBOARD_ORIGIN); empty means no cross-origin browser call is permitted.
  const dashboardOrigin = process.env['DASHBOARD_ORIGIN'];
  void app.register(cors, {
    origin:
      process.env['NODE_ENV'] === 'production'
        ? dashboardOrigin
          ? [dashboardOrigin]
          : false
        : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  void app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
  const uploadsRoot = join(process.cwd(), 'uploads');
  void app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: '/uploads/',
    decorateReply: false,
    // uploads holds what customers and staff sent, some under their own file names, on the
    // dashboard's own hostname (the /app proxy below). A document named x.html or x.svg must never
    // render as a page there - it would run that script on the dashboard's origin. Photos still
    // show inline; everything else downloads.
    setHeaders: (res, path) => {
      for (const [name, value] of Object.entries(uploadFileHeaders(uploadsRoot, path))) res.setHeader(name, value);
    },
  });

  // ─── Dashboard, on the one public hostname we have ───────────────────────
  //
  // The PC is served by a single Cloudflare Tunnel, on this API's port, and everything public
  // lives on one hostname. That is deliberate rather than forced: push subscriptions are scoped
  // to an origin, so a second hostname for the dashboard would split them from the API that
  // sends them, and it would be one more name to keep in sync with the Chakra webhook. So the
  // dashboard rides through here: browser -> tunnel -> this API -> 127.0.0.1:40070.
  //
  // The dashboard stays bound to loopback; nothing about install.ps1 changes. It sets
  // basePath: '/app' so its own asset and router URLs line up with this prefix.
  //
  // Set DASHBOARD_UPSTREAM='' to turn the proxy off and go back to a purely local dashboard.
  const dashboardUpstream = process.env['DASHBOARD_UPSTREAM'] ?? 'http://127.0.0.1:40070';
  if (dashboardUpstream) {
    // The only browser-facing surface on this host, so it is the only one that needs a brute
    // force gate: the login page and NextAuth's credentials callback now both sit behind it.
    // Generous enough that a dashboard page load (Next.js fetches many chunks) never trips it.
    //
    // Keyed on the forwarded address, not the socket: every request arrives from the tunnel, so
    // request.ip is the same value for all of them and a single shared bucket would lock the
    // whole team out over ordinary browsing - worse than having no limit. A spoofed
    // X-Forwarded-For only widens the spoofer's own bucket, which is why reading it untrusted is
    // fine here and would not be for auth.
    void app.register(async (scope) => {
      await scope.register(rateLimit, {
        max: 300,
        timeWindow: '1 minute',
        keyGenerator: (req) => (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip,
      });
      // @fastify/multipart, registered above for the API's own upload routes, is inherited here
      // and its multipart/form-data parser outranks the proxy's catch-all '*' one. That parser
      // only flags the request and never hands the payload on, so reply-from forwarded every
      // dashboard upload to Next with an EMPTY body: request.formData() threw and the browser
      // got a bare 500 in ~150ms. Import Excel died here on 2026-09-30, and product-image,
      // catalog-PDF and attachment uploads went with it. Nothing in this scope reads multipart.
      scope.removeContentTypeParser('multipart/form-data');
      await scope.register(httpProxy, {
        upstream: dashboardUpstream,
        prefix: '/app',
        // Next.js builds its own absolute URLs from basePath, so the prefix must survive.
        rewritePrefix: '/app',
        websocket: false,
        // See forwardOriginalHost above - without this every Server Action 500s.
        replyOptions: { rewriteRequestHeaders: forwardOriginalHost },
      });
    });

    // Staff type the bare hostname on a phone; the dashboard lives one path down. Cheaper to
    // redirect than to explain. 302, not 301 - a permanent redirect would be cached by every
    // browser that ever hit the root and would outlive any decision to move the dashboard.
    app.get('/', async (_request, reply) => reply.redirect('/app', 302));
  }

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Routes
  void app.register(webhookRoutes);
  void app.register(conversationRoutes);
  void app.register(contactRoutes);
  void app.register(escalationRoutes);
  void app.register(teamQueueRoutes);
  void app.register(numberRoutes);
  void app.register(catalogRoutes);
  void app.register(catalogProductRoutes);
  void app.register(catalogPreviewRoutes);
  void app.register(brandPriceListRoutes);
  void app.register(sendRoutes);
  void app.register(testPromptRoutes);
  void app.register(authRoutes);
  void app.register(settingsRoutes);
  void app.register(chakraSyncRoutes);
  void app.register(staffRoutes);
  void app.register(activityLogRoutes);
  void app.register(attachmentRoutes);
  void app.register(uploadRoutes);
  void app.register(leadRoutes);
  void app.register(pushRoutes);

  return app;
}
