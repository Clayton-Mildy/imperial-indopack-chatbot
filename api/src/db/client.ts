import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  _pool = new Pool({ connectionString });
  // An idle client that loses its connection (PostgreSQL restarted, network blip) is reported as
  // an 'error' event on the pool - and an 'error' event with no listener crashes the process. The
  // pool replaces the client by itself; all we need to do is not die.
  _pool.on('error', (err) => {
    console.error('[db] idle client error (pool keeps running):', err.message);
  });
  _db = drizzle(_pool, { schema });

  return _db;
}

export type Db = ReturnType<typeof getDb>;
