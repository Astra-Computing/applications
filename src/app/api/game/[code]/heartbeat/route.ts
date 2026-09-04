import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, isValidCode } from '@/lib/gameState';
import { refreshHeartbeat, playerNameForToken } from '@/lib/gameLogic';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  // Token only: the name is resolved from it once the state is loaded. A client
  // that still sends `x-player-name` is served normally - the header is never
  // read, so it cannot be wrong.
  const playerToken = req.headers.get('x-player-token');
  if (!playerToken) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let authError = false;
  const state = await loadAndUpdate(code, s => {
    const playerName = playerNameForToken(s, playerToken);
    if (!playerName) { authError = true; return s; }
    return refreshHeartbeat(s, playerName);
  });
  if (!state) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (authError) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  return NextResponse.json({ ok: true });
}
