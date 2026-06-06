import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, deleteState, isValidCode } from '@/lib/gameState';
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
  if (state.status === 'done') await deleteState(code);
  return NextResponse.json({ ok: true });
}
