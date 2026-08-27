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

  let body: { matchupIndex?: unknown; choice?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }
  const { matchupIndex, choice } = body;
  // Must be a real integer index, not merely non-null: castVote compares with
  // `i !== matchupIndex`, so a string "0" (trivially produced by reading a DOM
  // dataset attribute) matched no matchup and silently discarded the vote
  // while still returning 200.
  if (!Number.isInteger(matchupIndex) || (matchupIndex as number) < 0) {
    return NextResponse.json({ error: 'Invalid matchup index' }, { status: 400 });
  }
  if (choice !== 'a' && choice !== 'b') {
    return NextResponse.json({ error: 'Invalid choice' }, { status: 400 });
  }
  const index = matchupIndex as number;

  let authError = false;
  let phaseError = false;
  let rangeError = false;
  const state = await loadAndUpdate(code, s => {
    if (s.playerTokens[playerName] !== playerToken) { authError = true; return s; }
    if (s.status !== 'voting') { phaseError = true; return s; }
    if (index >= s.matchups.length) { rangeError = true; return s; }
    return castVote(s, index, playerName, choice);
  });
  if (!state)     return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (authError)  return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (phaseError) return NextResponse.json({ error: 'Voting is not open' }, { status: 409 });
  if (rangeError) return NextResponse.json({ error: 'No such matchup' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
