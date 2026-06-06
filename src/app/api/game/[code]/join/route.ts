import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, isValidCode } from '@/lib/gameState';
import { joinGame } from '@/lib/gameLogic';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const playerToken = crypto.randomUUID();
  const state = await loadAndUpdate(code, s => joinGame(s, name.trim(), playerToken));
  if (!state) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  return NextResponse.json({ ok: true, token: playerToken });
}
