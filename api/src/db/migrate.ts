import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// api and worker run the same image and both migrate on boot. Unserialized,
// both read the same "last applied" row and both apply every pending
// migration. A session-level advisory lock makes the second process wait,
// then find nothing left to do. The client has a single connection so the
// lock, the migration and the unlock all run in the same session.
const MIGRATION_LOCK_ID = 7_220_413;

export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    try {
      await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
    } catch (err: any) {
      // 42P07 = "relation already exists": a database created before drizzle
      // tracked migrations. Its tables are already in place.
      if (err?.cause?.code !== '42P07') throw err;
      console.log('[drizzle] Tables already exist, skipping initial migration');
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    }
  } finally {
    await sql.end();
  }
}
