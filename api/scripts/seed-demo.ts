/**
 * Demo data seed script — populates phone_numbers, contacts, conversations, and messages
 * with realistic Indonesian WhatsApp support data for demos.
 *
 * Run: npx tsx scripts/seed-demo.ts
 *
 * Idempotent: uses onConflictDoNothing() / upserts on unique keys.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';

const now = Date.now();
const mins = (n: number) => new Date(now - n * 60_000);

async function seedDemo() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  console.log('=== Seeding demo data ===\n');

  // ─── 1. Phone Numbers ────────────────────────────────────────────────────

  const phoneRows = await db
    .insert(schema.phoneNumbers)
    .values([
      {
        number: '+6281234567890',
        label: 'CS Line 1',
        wabaId: '1488029489715247',
        phoneNumberId: '1126456373884779',
      },
      {
        number: '+6285678901234',
        label: 'CS Line 2',
        wabaId: '1488029489715247',
        phoneNumberId: '1126456373884780',
      },
    ])
    .onConflictDoNothing()
    .returning();

  // Fetch all (in case some already existed)
  const allPhones = await db.query.phoneNumbers.findMany();
  const phone = (num: string) => allPhones.find((p) => p.number === num)!;
  const csLine1 = phone('+6281234567890');
  const csLine2 = phone('+6285678901234');

  const inserted = { phones: phoneRows.length };
  console.log(`Phone numbers inserted: ${phoneRows.length} (${allPhones.length} total)`);

  // ─── 2. Contacts ─────────────────────────────────────────────────────────

  const contactRows = await db
    .insert(schema.contacts)
    .values([
      { waId: '6281700001111', displayName: 'Budi Santoso' },
      { waId: '6281300002222', displayName: null },
      { waId: '6285600003333', displayName: 'Siti Rahayu' },
      { waId: '6281100004444', displayName: 'Ahmad Fauzi' },
      { waId: '6285600005555', displayName: null },
    ])
    .onConflictDoNothing()
    .returning();

  const allContacts = await db.query.contacts.findMany();
  const contact = (waId: string) => allContacts.find((c) => c.waId === waId)!;
  const budi = contact('6281700001111');
  const unknown81300 = contact('6281300002222');
  const siti = contact('6285600003333');
  const ahmad = contact('6281100004444');
  const unknown85600 = contact('6285600005555');

  console.log(`Contacts inserted: ${contactRows.length} (${allContacts.length} total)`);

  // ─── 3. Conversations ────────────────────────────────────────────────────

  // We need to upsert conversations. The unique index is on (contact_id, phone_number_id).
  // Insert with onConflictDoNothing, then fetch.

  const convDefs = [
    {
      contactId: budi.id,
      phoneNumberId: csLine1.id,
      status: 'active',
      escalationReason: null,
    },
    {
      contactId: unknown81300.id,
      phoneNumberId: csLine2.id,
      status: 'escalated',
      escalationReason: 'Pertanyaan stok real-time dan COD — di luar katalog',
    },
    {
      contactId: siti.id,
      phoneNumberId: csLine1.id,
      status: 'closed',
      escalationReason: null,
    },
    {
      contactId: ahmad.id,
      phoneNumberId: csLine2.id,
      status: 'active',
      escalationReason: null,
    },
    {
      contactId: unknown85600.id,
      phoneNumberId: csLine1.id,
      status: 'escalated',
      escalationReason: 'Pelanggan meminta bicara dengan manusia',
    },
  ];

  const convRows = await db
    .insert(schema.conversations)
    .values(convDefs)
    .onConflictDoNothing()
    .returning();

  // Re-fetch all conversations to get IDs (including pre-existing ones)
  const allConvs = await db.query.conversations.findMany();
  const findConv = (contactId: string, phoneId: string) =>
    allConvs.find((c) => c.contactId === contactId && c.phoneNumberId === phoneId)!;

  const conv1 = findConv(budi.id, csLine1.id);
  const conv2 = findConv(unknown81300.id, csLine2.id);
  const conv3 = findConv(siti.id, csLine1.id);
  const conv4 = findConv(ahmad.id, csLine2.id);
  const conv5 = findConv(unknown85600.id, csLine1.id);

  console.log(`Conversations inserted: ${convRows.length} (${allConvs.length} total)`);

  // ─── 4. Messages ─────────────────────────────────────────────────────────

  // Check existing messages per conversation to stay idempotent
  const existingMsgConvIds = new Set(
    (await db.query.messages.findMany()).map((m) => m.conversationId)
  );

  const allMessageDefs: Array<{
    conversationId: string;
    role: string;
    body: string;
    createdAt: Date;
  }> = [];

  // conv1 — Budi Santoso, active (~2 min ago most recent)
  if (!existingMsgConvIds.has(conv1.id)) {
    allMessageDefs.push(
      { conversationId: conv1.id, role: 'customer', body: 'Halo, berapa harga kipas angin Aomori yang 500W?', createdAt: mins(12) },
      { conversationId: conv1.id, role: 'bot', body: 'Halo Budi! Kipas Angin Stand Aomori 500W tersedia dengan harga Rp 245.000. Tersedia dalam warna putih dan abu-abu, dengan 3 kecepatan dan diameter 40cm. Ada yang ingin Anda tanyakan lebih lanjut?', createdAt: mins(11) },
      { conversationId: conv1.id, role: 'customer', body: 'Apakah ada varian warna lain?', createdAt: mins(7) },
      { conversationId: conv1.id, role: 'bot', body: 'Untuk saat ini tersedia dalam warna putih dan abu-abu. Keduanya memiliki spesifikasi yang sama. Apakah Anda tertarik untuk memesan?', createdAt: mins(6) },
      { conversationId: conv1.id, role: 'customer', body: 'Oke, bagaimana cara pemesanan?', createdAt: mins(2) },
    );
  }

  // conv2 — unknown (+62813), escalated
  if (!existingMsgConvIds.has(conv2.id)) {
    allMessageDefs.push(
      { conversationId: conv2.id, role: 'customer', body: 'Apakah bisa COD untuk pengiriman ke Surabaya?', createdAt: mins(45) },
      { conversationId: conv2.id, role: 'bot', body: 'Maaf, saya tidak memiliki informasi mengenai metode pengiriman dan COD. Tim kami akan segera membantu Anda.', createdAt: mins(44) },
      { conversationId: conv2.id, role: 'customer', body: 'Berapa lama pengirimannya?', createdAt: mins(40) },
    );
  }

  // conv3 — Siti Rahayu, closed
  if (!existingMsgConvIds.has(conv3.id)) {
    allMessageDefs.push(
      { conversationId: conv3.id, role: 'customer', body: 'Halo, saya mau tanya tentang Exhaust Fan Vintage', createdAt: mins(120) },
      { conversationId: conv3.id, role: 'bot', body: 'Halo Siti! Kami memiliki Exhaust Fan Vintage 8 inch seharga Rp 185.000 dan 10 inch seharga Rp 225.000. Keduanya cocok untuk sirkulasi udara optimal. Ada yang ingin Anda ketahui?', createdAt: mins(119) },
      { conversationId: conv3.id, role: 'customer', body: 'Terima kasih atas bantuannya!', createdAt: mins(115) },
      { conversationId: conv3.id, role: 'bot', body: 'Sama-sama Siti! Jangan ragu untuk menghubungi kami kembali jika ada pertanyaan. Selamat berbelanja! 😊', createdAt: mins(114) },
    );
  }

  // conv4 — Ahmad Fauzi, active
  if (!existingMsgConvIds.has(conv4.id)) {
    allMessageDefs.push(
      { conversationId: conv4.id, role: 'customer', body: 'Apakah kipas Aomori tersedia di Bandung?', createdAt: mins(30) },
      { conversationId: conv4.id, role: 'bot', body: 'Halo Ahmad! Untuk informasi ketersediaan di kota tertentu, saya tidak memiliki data tersebut secara real-time. Namun kami dapat membantu proses pemesanan. Produk apa yang Anda minati?', createdAt: mins(29) },
      { conversationId: conv4.id, role: 'customer', body: 'Kipas meja yang 150W ada?', createdAt: mins(25) },
      { conversationId: conv4.id, role: 'bot', body: 'Kipas Angin Meja Aomori 150W tersedia dengan harga Rp 125.000. Kompak dan cocok untuk ruang kerja, dengan 2 kecepatan. Apakah Anda ingin memesan?', createdAt: mins(24) },
    );
  }

  // conv5 — unknown (+62856), escalated (~22 min ago most recent)
  if (!existingMsgConvIds.has(conv5.id)) {
    allMessageDefs.push(
      { conversationId: conv5.id, role: 'customer', body: 'Halo ada orang?', createdAt: mins(28) },
      { conversationId: conv5.id, role: 'customer', body: 'Kok tidak dibalas?', createdAt: mins(26) },
      { conversationId: conv5.id, role: 'bot', body: 'Maaf atas keterlambatan! Ada yang bisa kami bantu?', createdAt: mins(25) },
      { conversationId: conv5.id, role: 'customer', body: 'Saya ingin bicara dengan manusia saja', createdAt: mins(22) },
    );
  }

  let msgInserted = 0;
  if (allMessageDefs.length > 0) {
    const msgRows = await db
      .insert(schema.messages)
      .values(allMessageDefs)
      .returning();
    msgInserted = msgRows.length;
  }

  console.log(`Messages inserted: ${msgInserted} (skipped convs with existing messages)`);

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log('\n=== Seed complete ===');
  console.log(`  Phone numbers : ${phoneRows.length} new`);
  console.log(`  Contacts      : ${contactRows.length} new`);
  console.log(`  Conversations : ${convRows.length} new`);
  console.log(`  Messages      : ${msgInserted} new`);
  console.log('\nConversation IDs:');
  console.log(`  conv1 (Budi Santoso, active)       : ${conv1?.id}`);
  console.log(`  conv2 (unknown +62813, escalated)  : ${conv2?.id}`);
  console.log(`  conv3 (Siti Rahayu, closed)        : ${conv3?.id}`);
  console.log(`  conv4 (Ahmad Fauzi, active)        : ${conv4?.id}`);
  console.log(`  conv5 (unknown +62856, escalated)  : ${conv5?.id}`);

  await pool.end();
}

seedDemo().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
