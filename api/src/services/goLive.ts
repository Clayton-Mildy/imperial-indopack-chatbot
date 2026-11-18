/**
 * Is the WhatsApp number connected, and what still blocks go-live? Feeds the dashboard's
 * Pengaturan page and its go-live banner.
 */
import { and, eq, exists, like, sql } from 'drizzle-orm';
import { getConfig, type Config } from '../config.js';
import { getDb } from '../db/client.js';
import { messages, phoneNumbers, productVariants, products, variantPriceTiers } from '../db/schema.js';
import { BRAND_SLUGS } from '../domain/brands.js';
import type { BrandSlug } from '../domain/orderProfile.js';
import { getPoFormUrl, PO_FORM_PLACEHOLDER_URL } from '../repositories/appSettings.js';
import { getBrandRowsBySlug } from '../repositories/products.js';

export type WhatsAppTransport = 'chakra' | 'meta' | 'capture';

export interface WhatsAppStatus {
  transport: WhatsAppTransport;
  credentialsSet: boolean;
  numberCount: number;
  connected: boolean;
  lastInboundAt: string | null;
}

export type GoLiveIssue =
  | { code: 'po_form_placeholder' }
  | { code: 'whatsapp_not_connected' }
  | { code: 'catalog_empty' }
  | { code: 'catalog_demo' }
  | { code: 'price_list_missing'; brand: BrandSlug };

/** Products whose name ends with this are demo data (scripts/load-demo-catalog.ts). */
export const DEMO_SUFFIX = '(CONTOH)';

export function credentialsSet(c: Config): boolean {
  if (c.WHATSAPP_TRANSPORT === 'chakra') return !!(c.CHAKRA_ACCESS_TOKEN && c.CHAKRA_PLUGIN_ID && c.CHAKRA_WEBHOOK_SECRET);
  if (c.WHATSAPP_TRANSPORT === 'meta') return !!(c.META_ACCESS_TOKEN && c.META_WEBHOOK_SECRET && c.META_WEBHOOK_VERIFY_TOKEN);
  return false;
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  const cfg = getConfig();
  const db = getDb();
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(phoneNumbers);
  const [last] = await db
    .select({ at: sql<Date | null>`max(${messages.createdAt})` })
    .from(messages)
    .where(eq(messages.role, 'user'));
  const numberCount = count?.n ?? 0;
  const set = credentialsSet(cfg);
  return {
    transport: cfg.WHATSAPP_TRANSPORT,
    credentialsSet: set,
    numberCount,
    connected: set && numberCount > 0,
    lastInboundAt: last?.at ? new Date(last.at).toISOString() : null,
  };
}

/** An active variant (of an active product) with at least one tier, optionally of a demo product. */
async function hasActiveTieredVariant(demoOnly: boolean): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productVariants.isActive, true),
        demoOnly ? like(products.name, `%${DEMO_SUFFIX}`) : undefined,
        demoOnly ? undefined : exists(db.select({ one: sql`1` }).from(variantPriceTiers).where(eq(variantPriceTiers.variantId, productVariants.id))),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function getGoLiveIssues(): Promise<GoLiveIssue[]> {
  const issues: GoLiveIssue[] = [];
  if ((await getPoFormUrl()) === PO_FORM_PLACEHOLDER_URL) issues.push({ code: 'po_form_placeholder' });
  if (!(await getWhatsAppStatus()).connected) issues.push({ code: 'whatsapp_not_connected' });
  if (!(await hasActiveTieredVariant(false))) issues.push({ code: 'catalog_empty' });
  if (await hasActiveTieredVariant(true)) issues.push({ code: 'catalog_demo' });
  const rows = await getBrandRowsBySlug();
  for (const brand of BRAND_SLUGS) {
    if (!rows[brand]?.catalogFileUrl) issues.push({ code: 'price_list_missing', brand });
  }
  return issues;
}
