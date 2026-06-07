import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, isValidCode } from '@/lib/gameState';
import { joinGame, PLAYER_TIMEOUT_MS } from '@/lib/gameLogic';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  const { name, existingToken } = await req.json() as { name: string; existingToken?: string };
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  const trimName = name.trim();

  let playerToken = '';
  let nameTaken = false;

  const state = await loadAndUpdate(code, s => {
    const storedToken = s.playerTokens[trimName];

    if (storedToken) {
      if (existingToken && existingToken === storedToken) {
        // Valid rejoin — restore the same token and refresh heartbeat
        playerToken = storedToken;
        return { ...s, participants: { ...s.participants, [trimName]: Date.now() } };
      }
      // Name is held by someone else — block if they're still active
      const lastSeen = s.participants[trimName] ?? 0;
      if (Date.now() - lastSeen < PLAYER_TIMEOUT_MS) {
        nameTaken = true;
        return s;
      }
      // Stale player — allow new joiner to take the name
    }

    playerToken = crypto.randomUUID();
    return joinGame(s, trimName, playerToken);
  });

  if (!state)    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (nameTaken) return NextResponse.json({ error: 'That name is already taken. Please choose a different one.' }, { status: 409 });
  return NextResponse.json({ ok: true, token: playerToken });
}
