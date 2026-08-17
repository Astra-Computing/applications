import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { redis } from './redis';
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

// ── Distributed lock (SET NX PX + Lua compare-and-delete release) ──────────

const LOCK_TTL_MS      = 5_000; // safety-net auto-expiry if a holder dies mid-critical-section
const LOCK_MAX_WAIT_MS = 4_000;

const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

function lockKey(roomCode: string) { return `lock:${roomCode}`; }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function acquireLock(roomCode: string): Promise<string> {
  const token    = randomUUID();
  const key      = lockKey(roomCode);
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    const ok = await redis.set(key, token, { nx: true, px: LOCK_TTL_MS });
    if (ok === 'OK') return token;
    const backoff = Math.min(200, 20 * 2 ** attempt) + Math.random() * 30;
    await sleep(backoff);
    attempt++;
  }
  throw new Error(`Could not acquire lock for room ${roomCode} within ${LOCK_MAX_WAIT_MS}ms`);
}

async function releaseLock(roomCode: string, token: string): Promise<void> {
  try {
    await redis.eval(RELEASE_LOCK_SCRIPT, [lockKey(roomCode)], [token]);
  } catch (e) {
    // Non-fatal — the PX TTL will expire the lock on its own.
    console.error(`Failed to release lock for ${roomCode}`, e);
  }
}

export async function withRoomLock<T>(roomCode: string, fn: () => Promise<T>): Promise<T> {
  const token = await acquireLock(roomCode);
  try {
    return await fn();
  } finally {
    await releaseLock(roomCode, token);
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

const STATE_TTL_SECONDS = 24 * 60 * 60;

function stateKey(roomCode: string) { return `game:${roomCode}`; }

export function isValidCode(code: string): boolean {
  return /^[A-Z]{4}$/.test(code);
}

async function readState(roomCode: string): Promise<GameState | null> {
  const envelope = await redis.get<EncryptedEnvelope>(stateKey(roomCode));
  if (!envelope) return null;
  try {
    return JSON.parse(decryptState(envelope)) as GameState;
  } catch {
    return null;
  }
}

async function writeState(state: GameState): Promise<void> {
  const envelope = encryptState(JSON.stringify(state));
  await redis.set(stateKey(state.roomCode), envelope, { ex: STATE_TTL_SECONDS });
}

export async function loadState(roomCode: string): Promise<GameState | null> {
  return withRoomLock(roomCode, () => readState(roomCode));
}

export async function saveState(state: GameState): Promise<void> {
  return withRoomLock(state.roomCode, () => writeState(state));
}

export async function deleteState(roomCode: string): Promise<void> {
  return withRoomLock(roomCode, async () => { await redis.del(stateKey(roomCode)); });
}

// Verify host token and delete atomically under the room lock.
export async function verifyAndDelete(
  roomCode: string,
  hostToken: string,
): Promise<{ found: boolean; authorized: boolean }> {
  return withRoomLock(roomCode, async () => {
    const state = await readState(roomCode);
    if (!state) return { found: false, authorized: false };
    if (state.hostToken !== hostToken) return { found: true, authorized: false };
    await redis.del(stateKey(roomCode));
    return { found: true, authorized: true };
  });
}

export async function loadAndUpdate(
  roomCode: string,
  updater: (state: GameState) => GameState,
): Promise<GameState | null> {
  return withRoomLock(roomCode, async () => {
    const state = await readState(roomCode);
    if (!state) return null;
    const next = updater(state);
    await writeState(next);
    return next;
  });
}
