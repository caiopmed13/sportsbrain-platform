// One-shot: aplica migrations/neon_init.sql no Neon.
// Uso: node scripts/apply-neon-schema.mjs "<connection-string>"
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const connStr = process.argv[2];
if (!connStr) {
  console.error('Usage: node scripts/apply-neon-schema.mjs "postgres://..."');
  process.exit(1);
}

const sql = postgres(connStr, { ssl: 'require', max: 1 });

try {
  const ddl = readFileSync(new URL('../migrations/neon_init.sql', import.meta.url), 'utf8');
  console.log(`[neon] applying ${ddl.split('\n').length} lines of DDL...`);
  await sql.unsafe(ddl);
  const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  console.log('[neon] ok. tables:');
  for (const r of rows) console.log('  -', r.tablename);
} catch (e) {
  console.error('[neon] FAIL:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
