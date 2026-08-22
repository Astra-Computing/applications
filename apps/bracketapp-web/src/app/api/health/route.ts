import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
// Without this the handler has no dynamic inputs and Next prerenders it at
// build time, so it would serve a cached {status:'ok'} forever - reporting
// healthy while the database was unreachable and every game was failing.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await sql`SELECT 1`;
    return NextResponse.json({ status: 'ok', db: 'up' });
  } catch {
    return NextResponse.json({ status: 'degraded', db: 'down' }, { status: 503 });
  }
}
