import { NextRequest, NextResponse } from 'next/server';
import { createGame } from '@/lib/gameLogic';
import { saveState } from '@/lib/gameState';
import { checkRateLimit } from '@/lib/rateLimit';
import { Quote } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_QUOTES    = 512;
const MAX_TEXT_LEN  = 2000;
const MAX_AUTHOR_LEN = 200;

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
    const state = createGame(quotes, hostToken);
    await saveState(state);
    return NextResponse.json({ roomCode: state.roomCode, hostToken });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
