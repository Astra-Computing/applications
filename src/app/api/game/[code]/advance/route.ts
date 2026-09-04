import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, isValidCode } from '@/lib/gameState';
import { advanceRound } from '@/lib/gameLogic';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  const hostToken = req.headers.get('x-host-token');
  if (!hostToken) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let authError = false;
  let phaseError = false;
  const state = await loadAndUpdate(code, s => {
    if (s.hostToken !== hostToken) { authError = true; return s; }
    if (s.status !== 'voting') { phaseError = true; return s; }
    return advanceRound(s);
  });
  if (!state)    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (authError) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (phaseError) return NextResponse.json({ error: 'Voting is not open' }, { status: 409 });
  // Deliberately NOT deleted when the game reaches 'done'. Deleting here raced
  // the 2s client poll: every client 404'd before it could ever observe the
  // final state, so nobody - host included - saw the champion. The room is
  // removed by the host's explicit "End Game" (/end) or the 24h sweep.
  // Clients stop polling once they see 'done', so the row goes idle either way.
  // Strip secrets exactly as the GET route does - the raw state carries every
  // player's token, which the host has no business receiving.
  const { hostToken: _h, playerTokens: _p, removedTokens: _r, ...hostState } = state;
  return NextResponse.json({ ok: true, state: hostState });
}
