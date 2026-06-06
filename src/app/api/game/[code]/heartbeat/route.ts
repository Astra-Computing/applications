import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, isValidCode } from '@/lib/gameState';
import { refreshHeartbeat } from '@/lib/gameLogic';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  const playerToken = req.headers.get('x-player-token');
  const playerName  = req.headers.get('x-player-name');
  if (!playerToken || !playerName) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let authError = false;
  const state = await loadAndUpdate(code, s => {
    if (s.playerTokens[playerName] !== playerToken) { authError = true; return s; }
    return refreshHeartbeat(s, playerName);
  }, { notify: false });
  if (!state) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (authError) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  return NextResponse.json({ ok: true });
}
