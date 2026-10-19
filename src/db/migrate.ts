import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { requireDatabaseUrl } from '../config.js';

const pool = new pg.Pool({ connectionString: requireDatabaseUrl() });
await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
await pool.end();
console.log('Migrations appliquées.');
