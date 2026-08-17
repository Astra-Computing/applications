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

export const sql = postgres(connectionString, { prepare: false });
