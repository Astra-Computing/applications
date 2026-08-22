import postgres, { Sql } from 'postgres';

let client: Sql | null = null;

// Created lazily, not at module scope. Next.js imports every route module
// during "Collecting page data" at build time, so constructing the client (and
// throwing on a missing env var) up here made a production build depend on
// production database credentials - builds failed on any environment that had
// not been given the secrets yet. Now a build needs nothing; the connection,
// and the error if the connection string is absent, happens on first query.
//
// Uses Supabase's transaction-mode connection pooler (Supavisor, port 6543) -
// the right choice for serverless functions, which open and close connections
// per invocation rather than holding a long-lived pool themselves.
// prepare:false is required in transaction-pooling mode: prepared statements
// are not shared across the backend connections the pooler hands out.
// max:1 because every Vercel lambda instance gets its own pool, so a
// per-instance pool of 10 multiplies across concurrent invocations and
// exhausts Supavisor's client limit under load.
export function getSql(): Sql {
  if (client) return client;

  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing Postgres connection string: set SUPABASE_DB_URL (or DATABASE_URL).');
  }

  client = postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
  });
  return client;
}
