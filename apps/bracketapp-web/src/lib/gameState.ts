import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { TransactionSql } from 'postgres';
import { sql } from './db';
import { GameState } from './types';

// ── Encryption (AES-256-GCM) ────────────────────────────────────────────────
//
// Set GAME_ENCRYPTION_KEY to a 64-char hex string (32 bytes) in .env.local.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// If the env var is absent (local dev), a fixed dev key is used — not secure.

const ALGORITHM = 'aes-256-gcm';
const DEV_KEY   = Buffer.from('uq_game_dev_only_key_placeholder', 'utf-8'); // exactly 32 bytes

interface EncryptedEnvelope { iv: string; tag: string; enc: string }

function getEncryptionKey(): Buffer {
  const envKey = process.env.GAME_ENCRYPTION_KEY;
  if (!envKey) return DEV_KEY;
  const buf = Buffer.from(envKey, 'hex');
  if (buf.length !== 32) throw new Error('GAME_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  return buf;
}

function encryptState(plaintext: string): EncryptedEnvelope {
  const key = getEncryptionKey();
  const iv  = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return {
    iv:  iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    enc: encrypted.toString('base64'),
  };
}

function decryptState(envelope: EncryptedEnvelope): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.enc, 'base64')),
    decipher.final(),
  ]).toString('utf-8');
}

// ── Row lock ─────────────────────────────────────────────────────────────
//
// `SELECT ... FOR UPDATE` inside a transaction blocks concurrent transactions
// touching the same room row until this one commits — Postgres does the
// serialization natively, no manual lock-token/retry loop needed. This works
// correctly through Supabase's transaction-mode pooler because the whole
// BEGIN..COMMIT block runs on one backend connection for its duration.

interface GameRow { room_code: string; envelope: EncryptedEnvelope }

async function withRoomLock<T>(
  roomCode: string,
  fn: (tx: TransactionSql, row: GameRow | null) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    const rows = await tx<GameRow[]>`
      SELECT room_code, envelope FROM game_states WHERE room_code = ${roomCode} FOR UPDATE
    `;
    return fn(tx, rows[0] ?? null);
  }) as Promise<T>;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function isValidCode(code: string): boolean {
  return /^[A-Z]{4}$/.test(code);
}

export async function loadState(roomCode: string): Promise<GameState | null> {
  return withRoomLock(roomCode, async (_tx, row) => {
    if (!row) return null;
    try {
      return JSON.parse(decryptState(row.envelope)) as GameState;
    } catch {
      return null;
    }
  });
}

export async function saveState(state: GameState): Promise<void> {
  await withRoomLock(state.roomCode, async (tx) => {
    const envelope = encryptState(JSON.stringify(state));
    await tx`
      INSERT INTO game_states (room_code, envelope, updated_at)
      VALUES (${state.roomCode}, ${sql.json(envelope as any)}, now())
      ON CONFLICT (room_code) DO UPDATE SET envelope = excluded.envelope, updated_at = now()
    `;
  });
}

export async function deleteState(roomCode: string): Promise<void> {
  await withRoomLock(roomCode, async (tx) => {
    await tx`DELETE FROM game_states WHERE room_code = ${roomCode}`;
  });
}

// Verify host token and delete atomically under the room lock.
export async function verifyAndDelete(
  roomCode: string,
  hostToken: string,
): Promise<{ found: boolean; authorized: boolean }> {
  return withRoomLock(roomCode, async (tx, row) => {
    if (!row) return { found: false, authorized: false };
    let state: GameState;
    try {
      state = JSON.parse(decryptState(row.envelope)) as GameState;
    } catch {
      return { found: false, authorized: false };
    }
    if (state.hostToken !== hostToken) return { found: true, authorized: false };
    await tx`DELETE FROM game_states WHERE room_code = ${roomCode}`;
    return { found: true, authorized: true };
  });
}

export async function loadAndUpdate(
  roomCode: string,
  updater: (state: GameState) => GameState,
): Promise<GameState | null> {
  return withRoomLock(roomCode, async (tx, row) => {
    if (!row) return null;
    let state: GameState;
    try {
      state = JSON.parse(decryptState(row.envelope)) as GameState;
    } catch {
      return null;
    }
    const next = updater(state);
    const envelope = encryptState(JSON.stringify(next));
    await tx`UPDATE game_states SET envelope = ${sql.json(envelope as any)}, updated_at = now() WHERE room_code = ${roomCode}`;
    return next;
  });
}
