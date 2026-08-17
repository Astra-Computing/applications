import { NextRequest, NextResponse } from 'next/server';
import { verifyAndDelete, isValidCode } from '@/lib/gameState';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  const hostToken = req.headers.get('x-host-token');
  if (!hostToken) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { found, authorized } = await verifyAndDelete(code, hostToken);
  if (!found)      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (!authorized) return NextResponse.json({ error: 'Unauthorised' },  { status: 401 });

  return NextResponse.json({ ok: true });
}
