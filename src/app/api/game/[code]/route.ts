import { NextRequest, NextResponse } from 'next/server';
import { loadState, isValidCode } from '@/lib/gameState';
import { sanitizeForPlayer } from '@/lib/gameLogic';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  const state = await loadState(code);
  if (!state) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Host with valid token: return full state minus secret fields
  const hostToken = req.headers.get('x-host-token');
  if (hostToken && hostToken === state.hostToken) {
    const { hostToken: _h, playerTokens: _p, ...hostState } = state;
    return NextResponse.json(hostState);
  }

  // Player with valid token: return sanitised state with myVote populated
  const playerToken = req.headers.get('x-player-token');
  const playerName  = req.headers.get('x-player-name');
  if (playerToken && playerName && state.playerTokens[playerName] === playerToken) {
    return NextResponse.json(sanitizeForPlayer(state, playerName));
  }

  // Unauthenticated / spectator: sanitised state, no myVote
  return NextResponse.json(sanitizeForPlayer(state, null));
}
