import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { connect, applySchema, resetDatabase, countRooms, assertNotProduction } from '../support/db';

describe('test database', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connect();
    await applySchema(sql);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('applies the schema half without pg_cron', async () => {
    // schema.sql must stand alone: the stock Postgres image has no pg_cron,
    // and the sweeps are deliberately absent from the test database.
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`;
    expect(tables.map(t => t.table_name)).toEqual(['game_states', 'rate_limits']);
  });

  it('has no scheduled jobs', async () => {
    const [ext] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_extension where extname = 'pg_cron'`;
    expect(ext.n).toBe(0);
  });

  it('is re-runnable', async () => {
    await expect(applySchema(sql)).resolves.not.toThrow();
  });

  it('resets to empty', async () => {
    await sql`insert into game_states (room_code, envelope) values ('TEST', '{}'::jsonb)`;
    expect(await countRooms(sql)).toBeGreaterThan(0);
    await resetDatabase(sql);
    expect(await countRooms(sql)).toBe(0);
  });

  it('clears rate_limits too, so the ten-per-hour cap cannot stop a run', async () => {
    // The cap is application code keyed on the client IP, and tests send none,
    // so every request shares the 'unknown' key.
    await sql`insert into rate_limits (ip, count, reset_at) values ('unknown', 10, now() + interval '1 hour')`;
    await resetDatabase(sql);
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from rate_limits`;
    expect(row.n).toBe(0);
  });
});

describe('production guard (AE1)', () => {
  it.each([
    'postgres://u:p@aws-0-eu-west-2.pooler.supabase.com:6543/postgres',
    'postgres://u:p@db.abcdefgh.supabase.co:5432/postgres',
  ])('refuses a production URL: %s', url => {
    expect(() => assertNotProduction(url)).toThrow(/production Supabase/);
  });

  it('allows the local test database', () => {
    expect(() => assertNotProduction('postgres://uq:uq@test-db:5432/uq_test')).not.toThrow();
  });
});
