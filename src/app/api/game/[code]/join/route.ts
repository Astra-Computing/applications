import { NextRequest, NextResponse } from 'next/server';
import { loadAndUpdate, isValidCode } from '@/lib/gameState';
import { joinGame, PLAYER_TIMEOUT_MS, normalizePlayerName, hasVisibleCharacter } from '@/lib/gameLogic';

export const runtime = 'nodejs';

const MAX_NAME_LEN = 24;
const MAX_PLAYERS  = 100;

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return NextResponse.json({ error: 'Invalid room code' }, { status: 400 });

  let body: { name?: unknown; existingToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }
  const { name, existingToken } = body;
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 });
  }
  // Canonical form before any lookup (R3), so two names that differ only in
  // whitespace runs or Unicode composition cannot both hold a seat.
  const trimName = normalizePlayerName(name);
  // A name of only zero-width or formatting characters renders as nothing: it
  // is invisible in the roster and the host cannot address it (R4).
  if (!hasVisibleCharacter(trimName)) {
    return NextResponse.json({ error: 'Please use a name with at least one visible character.' }, { status: 400 });
  }
  // Player names are object keys inside the single encrypted state row, which
  // is decrypted and re-encrypted on every action. /create caps its input;
  // without the same caps here an unbounded name (or an unbounded number of
  // joins) inflates that row until every request on the room times out.
  if (trimName.length > MAX_NAME_LEN) {
    return NextResponse.json({ error: `Name must be ${MAX_NAME_LEN} characters or fewer` }, { status: 400 });
  }
  const token = typeof existingToken === 'string' ? existingToken : undefined;

  let playerToken = '';
  let nameTaken = false;
  let roomFull = false;

  const state = await loadAndUpdate(code, s => {
    const storedToken = Object.prototype.hasOwnProperty.call(s.playerTokens, trimName)
      ? s.playerTokens[trimName]
      : undefined;

    if (storedToken) {
      if (token && token === storedToken) {
        // Valid rejoin — restore the same token and refresh heartbeat
        playerToken = storedToken;
        return { ...s, participants: { ...s.participants, [trimName]: Date.now() } };
      }
      // Name is held by someone else — block if they're still active
      const lastSeen = Object.prototype.hasOwnProperty.call(s.participants, trimName)
        ? s.participants[trimName]
        : 0;
      if (Date.now() - lastSeen < PLAYER_TIMEOUT_MS) {
        nameTaken = true;
        return s;
      }
      // Stale player — allow new joiner to take the name
    }

    if (!storedToken && Object.keys(s.playerTokens).length >= MAX_PLAYERS) {
      roomFull = true;
      return s;
    }
    playerToken = crypto.randomUUID();
    return joinGame(s, trimName, playerToken);
  });

  if (!state)    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  if (nameTaken) return NextResponse.json({ error: 'That name is already taken. Please choose a different one.' }, { status: 409 });
  if (roomFull)  return NextResponse.json({ error: 'This game is full.' }, { status: 409 });
  return NextResponse.json({ ok: true, token: playerToken });
}
