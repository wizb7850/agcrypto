import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadDotEnv } from '../config.js';

loadDotEnv();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
await pool.end();
console.log('Migrations appliquées.');
