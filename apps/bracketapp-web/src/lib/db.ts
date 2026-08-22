import postgres from 'postgres';

// Use Supabase's transaction-mode connection pooler (Supavisor, port 6543) —
// the right choice for serverless functions, which open/close connections
// per invocation rather than holding a long-lived pool themselves.
// prepare:false is required in transaction-pooling mode: prepared statements
// aren't shared across the backend connections the pooler hands out.
const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Missing Postgres connection string: set SUPABASE_DB_URL (or DATABASE_URL).');
}

// max: 1 — every Vercel lambda instance gets its own pool, so a per-instance
// pool of 10 multiplies across concurrent invocations and exhausts Supavisor's
// client limit under load. One connection per instance is the serverless norm.
// idle_timeout releases it back to the pooler instead of holding it open.
export const sql = postgres(connectionString, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
});
