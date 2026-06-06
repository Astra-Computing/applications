import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, isValidCode } from '@/lib/gameState';
import { castVote } from '@/lib/gameLogic';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  const playerToken = req.headers.get('x-player-token');
  const playerName  = req.headers.get('x-player-name');
  if (!playerToken || !playerName) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { matchupIndex, choice } = await req.json() as { matchupIndex: number; choice: 'a' | 'b' };
  if (matchupIndex == null || !['a', 'b'].includes(choice)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  let authError = false;
  let phaseError = false;
  const state = await loadAndUpdate(code, s => {
    if (s.playerTokens[playerName] !== playerToken) { authError = true; return s; }
    if (s.status !== 'voting') { phaseError = true; return s; }
    return castVote(s, matchupIndex, playerName, choice);
  });
  if (!state)    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (authError) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (phaseError) return NextResponse.json({ error: 'Voting is not open' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
