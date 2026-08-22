import { NextRequest, NextResponse } from 'next/server';
import { createGame, generateRoomCode } from '@/lib/gameLogic';
import { tryCreateState } from '@/lib/gameState';
import { checkRateLimit } from '@/lib/rateLimit';
import { Quote } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_QUOTES    = 512;
const MAX_TEXT_LEN  = 2000;
const MAX_AUTHOR_LEN = 200;
const CODE_RETRIES   = 5;

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
             ?? req.headers.get('x-real-ip')
             ?? 'unknown';
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many games created. Try again later.' }, { status: 429 });
    }

    const { quotes } = await req.json() as { quotes: Quote[] };
    if (!Array.isArray(quotes) || quotes.length < 2) {
      return NextResponse.json({ error: 'Need at least 2 quotes' }, { status: 400 });
    }
    if (quotes.length > MAX_QUOTES) {
      return NextResponse.json({ error: `Too many quotes (max ${MAX_QUOTES})` }, { status: 400 });
    }
    for (const q of quotes) {
      if (typeof q.text !== 'string' || q.text.length > MAX_TEXT_LEN) {
        return NextResponse.json({ error: `Quote text exceeds ${MAX_TEXT_LEN} characters` }, { status: 400 });
      }
      if (typeof q.author !== 'string' || q.author.length > MAX_AUTHOR_LEN) {
        return NextResponse.json({ error: `Author name exceeds ${MAX_AUTHOR_LEN} characters` }, { status: 400 });
      }
    }

    const hostToken = crypto.randomUUID();
    // Room codes are 4 letters (456,976 combinations) and rooms linger for up
    // to 24h, so collisions are a question of when, not if. Insert-if-absent
    // and retry with a fresh code rather than upserting over a live game.
    let state = createGame(quotes, hostToken);
    let created = await tryCreateState(state);
    for (let attempt = 0; attempt < CODE_RETRIES && !created; attempt++) {
      state = { ...state, roomCode: generateRoomCode() };
      created = await tryCreateState(state);
    }
    if (!created) {
      return NextResponse.json({ error: 'Could not allocate a room code. Try again.' }, { status: 503 });
    }
    return NextResponse.json({ roomCode: state.roomCode, hostToken });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
