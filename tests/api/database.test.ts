import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { connect, applySchema, resetDatabase, countRooms, assertNotProduction } from '../support/db';
import { checkRateLimit } from '@/lib/rateLimit';
import { getSql } from '@/lib/db';

describe('test database', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connect();
    await applySchema(sql);
    // Truncate once at the top of the run, not only between the tests that
    // clean up after themselves. A run that dies partway through leaves its
    // rows behind, and the next run then failed on `duplicate key value
    // violates unique constraint "game_states_pkey"` - a green suite one day
    // and an unexplained failure the next, caused by nothing in the diff.
    await resetDatabase(sql);
  });

  // R6: every test starts from a known-clean database, so one test's rows
  // cannot reach another's assertions.
  beforeEach(async () => {
    await resetDatabase(sql);
  });

  afterAll(async () => {
    await sql.end();
    // checkRateLimit below goes through the application's own lazily-created
    // client, which is a different pool from `sql`. Closing it too keeps the
    // run from hanging on an idle connection.
    await getSql().end();
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
    // `.resolves` is what does the work here - a rejection fails the test.
    // `.not.toThrow()` used to be chained onto it and asserted nothing at all:
    // the matcher runs against the RESOLVED value, and `expect(undefined)
    // .not.toThrow()` passes silently, as does `expect(42).not.toThrow()`.
    await expect(applySchema(sql)).resolves.toBeUndefined();
  });

  it('resets to empty', async () => {
    await sql`insert into game_states (room_code, envelope) values ('TEST', '{}'::jsonb)`;
    expect(await countRooms(sql)).toBeGreaterThan(0);
    await resetDatabase(sql);
    expect(await countRooms(sql)).toBe(0);
  });

  it('clears rate_limits too', async () => {
    await sql`insert into rate_limits (ip, count, reset_at) values ('unknown', 10, now() + interval '1 hour')`;
    await resetDatabase(sql);
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from rate_limits`;
    expect(row.n).toBe(0);
  });

  // AE6, exercised against the real gate. The point is not that TRUNCATE empties
  // a table - that is a property of Postgres and proved nothing about this
  // project. The point is that the application's OWN ten-per-hour cap cannot
  // stop a test run, so the thing that has to be called is `checkRateLimit`.
  //
  // The cap is keyed on the client IP and tests send no x-forwarded-for, so
  // every call in the suite shares the 'unknown' key. Four rooms in each of four
  // tests is sixteen across this file, well past the cap of ten - and it works
  // only because `beforeEach` truncates `rate_limits`. Take that reset away and
  // the third test here goes red. That is the AE6 scenario as written: a file
  // creating more than ten rooms, not one test creating more than ten.
  it.each([1, 2, 3, 4])('creation batch %i of 4 is never refused by the cap', async () => {
    for (let i = 0; i < 4; i++) {
      expect(await checkRateLimit('unknown')).toBe(true);
    }
  });

  it('still enforces the cap inside one window, so the reset is what saves the suite', async () => {
    // The other direction. If checkRateLimit ever stopped limiting, the four
    // tests above would pass for the wrong reason and AE6 would mean nothing.
    for (let i = 0; i < 10; i++) expect(await checkRateLimit('cap-check')).toBe(true);
    expect(await checkRateLimit('cap-check')).toBe(false);
  });
});

describe('production guard (AE1)', () => {
  it.each([
    'postgres://u:p@aws-0-eu-west-2.pooler.supabase.com:6543/postgres',
    'postgres://u:p@db.abcdefgh.supabase.co:5432/postgres',
  ])('refuses a production URL: %s', url => {
    expect(() => assertNotProduction(url)).toThrow(/production Supabase/);
  });

  // The guard was a lowercase substring denylist and default-allowed. These are
  // the shapes that walked straight through it. `postgres:` is a non-special URL
  // scheme, so the WHATWG parser keeps the host's case - an uppercase Supabase
  // host is not a hypothetical.
  it.each([
    ['an uppercase Supabase host', 'postgres://u:p@DB.ABCDEFGH.SUPABASE.CO:5432/postgres'],
    ['a mixed-case pooler host', 'postgres://u:p@AWS-0-EU-WEST-2.Pooler.Supabase.com:6543/postgres'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertNotProduction(url)).toThrow(/production Supabase/);
  });

  it.each([
    ['a non-Supabase production host', 'postgres://u:p@prod.example.com:5432/app'],
    ['a bare IP', 'postgres://u:p@203.0.113.10:5432/app'],
    ['an unknown internal host', 'postgres://u:p@db-primary:5432/app'],
  ])('refuses %s, because what runs here truncates', (_label, url) => {
    expect(() => assertNotProduction(url)).toThrow(/not a known test database/);
  });

  it('refuses a string it cannot parse rather than letting it through', () => {
    expect(() => assertNotProduction('not a url at all')).toThrow(/could not be parsed/);
  });

  it.each([
    'postgres://uq:uq@test-db:5432/uq_test',
    'postgres://uq:uq@localhost:5432/uq_test',
    'postgres://uq:uq@127.0.0.1:5432/uq_test',
    'postgres://uq:uq@[::1]:5432/uq_test',
  ])('allows the local test database: %s', url => {
    expect(() => assertNotProduction(url)).not.toThrow();
  });

  it('allows the test host whatever its case', () => {
    expect(() => assertNotProduction('postgres://uq:uq@Test-DB:5432/uq_test')).not.toThrow();
  });
});
