import { NextRequest } from 'next/server';
import { loadState, isValidCode, roomEvents } from '@/lib/gameState';
import { sanitizeForPlayer } from '@/lib/gameLogic';
import { GameState } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!isValidCode(code)) return new Response('Invalid room code', { status: 400 });

  const url         = new URL(req.url);
  const hostToken   = url.searchParams.get('hostToken') ?? '';
  const playerToken = url.searchParams.get('playerToken') ?? '';
  const playerName  = url.searchParams.get('playerName') ?? '';

  const initial = await loadState(code);
  if (!initial) return new Response('Not found', { status: 404 });

  const encoder = new TextEncoder();

  function buildPayload(s: GameState): string {
    if (hostToken && hostToken === s.hostToken) {
      const { hostToken: _h, playerTokens: _p, ...hostState } = s;
      return JSON.stringify(hostState);
    }
    if (playerToken && playerName && s.playerTokens[playerName] === playerToken) {
      return JSON.stringify(sanitizeForPlayer(s, playerName));
    }
    return JSON.stringify(sanitizeForPlayer(s, null));
  }

  let cleanup = () => {};

  const stream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(`data: ${buildPayload(initial)}\n\n`));

      const onUpdate = (s: GameState) => {
        try {
          ctrl.enqueue(encoder.encode(`data: ${buildPayload(s)}\n\n`));
          if (s.status === 'done') {
            cleanup();
            ctrl.close();
          }
        } catch {
          cleanup();
        }
      };

      const keepAlive = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          cleanup();
        }
      }, 25_000);

      cleanup = () => {
        roomEvents.off(`update:${code}`, onUpdate);
        clearInterval(keepAlive);
      };

      roomEvents.on(`update:${code}`, onUpdate);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':     'text/event-stream',
      'Cache-Control':    'no-cache, no-transform',
      'Connection':       'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
