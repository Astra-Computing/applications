import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, isValidCode } from '@/lib/gameState';
import { kickPlayer, normalizePlayerName } from '@/lib/gameLogic';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  const hostToken = req.headers.get('x-host-token');
  if (!hostToken) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }
  // Mirrors the join route's guard, so a missing or non-string name is rejected
  // before it can be used as an object key.
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 });
  }
  // Normalised the same way join stores it, or a name that round-tripped
  // through the roster would not match its own key.
  const name = normalizePlayerName(body.name);

  let authError = false;
  const state = await loadAndUpdate(code, s => {
    if (s.hostToken !== hostToken) { authError = true; return s; }
    // An unknown name returns the state object unchanged, so no write occurs.
    return kickPlayer(s, name);
  });

  if (!state)    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (authError) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  // Responds { ok: true } and never the state object, following /start and
  // /end - the host repolls within 2s. Returning state here would also mean
  // stripping removedTokens on one more path.
  return NextResponse.json({ ok: true });
}
