import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { GameState } from './types';

export const roomEvents = new EventEmitter();
roomEvents.setMaxListeners(500);

const STATE_DIR = process.env.STATE_DIR ?? path.join(process.cwd(), 'game_states');

try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch {}

// ── Encryption (AES-256-GCM) ────────────────────────────────────────────────
//
// Set GAME_ENCRYPTION_KEY to a 64-char hex string (32 bytes) in .env.local.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// If the env var is absent (local dev), a fixed dev key is used — not secure.

const ALGORITHM = 'aes-256-gcm';
const DEV_KEY   = Buffer.from('uq_game_dev_only_key_placeholder', 'utf-8'); // exactly 32 bytes

function getEncryptionKey(): Buffer {
  const envKey = process.env.GAME_ENCRYPTION_KEY;
  if (!envKey) return DEV_KEY;
  const buf = Buffer.from(envKey, 'hex');
  if (buf.length !== 32) throw new Error('GAME_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  return buf;
}

function encryptState(plaintext: string): string {
  const key = getEncryptionKey();
  const iv  = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return JSON.stringify({
    iv:  iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    enc: encrypted.toString('base64'),
  });
}

function decryptState(raw: string): string {
  const { iv, tag, enc } = JSON.parse(raw) as { iv: string; tag: string; enc: string };
  const key     = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(enc, 'base64')),
    decipher.final(),
  ]).toString('utf-8');
}

// Try encrypted first; fall back to plaintext for pre-encryption files.
function readStateFile(p: string): GameState {
  const raw = fs.readFileSync(p, 'utf-8');
  try {
    return JSON.parse(decryptState(raw)) as GameState;
  } catch {
    return JSON.parse(raw) as GameState;
  }
}

// ── Mutex ───────────────────────────────────────────────────────────────────

const pending = new Map<string, Promise<unknown>>();

export async function withRoomLock<T>(roomCode: string, fn: () => Promise<T>): Promise<T> {
  const prev = pending.get(roomCode) ?? Promise.resolve();
  let release!: () => void;
  const lock = new Promise<void>(r => (release = r));
  const chain = prev.then(() => lock);
  pending.set(roomCode, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (pending.get(roomCode) === chain) pending.delete(roomCode);
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

function statePath(roomCode: string) { return path.join(STATE_DIR, `${roomCode}.json`); }

export async function loadState(roomCode: string): Promise<GameState | null> {
  return withRoomLock(roomCode, async () => {
    const p = statePath(roomCode);
    if (!fs.existsSync(p)) return null;
    try {
      return readStateFile(p);
    } catch {
      const backup = p + '.backup';
      if (fs.existsSync(backup)) {
        try { return readStateFile(backup); } catch {}
      }
      return null;
    }
  });
}

export async function saveState(state: GameState): Promise<void> {
  return withRoomLock(state.roomCode, async () => {
    const p   = statePath(state.roomCode);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, encryptState(JSON.stringify(state)), 'utf-8');
    if (fs.existsSync(p)) fs.copyFileSync(p, p + '.backup');
    fs.renameSync(tmp, p);
  });
}

export function isValidCode(code: string): boolean {
  return /^[A-Z]{4}$/.test(code);
}

export async function deleteState(roomCode: string): Promise<void> {
  return withRoomLock(roomCode, async () => {
    const p = statePath(roomCode);
    for (const file of [p, p + '.backup', p + '.tmp']) {
      try { fs.unlinkSync(file); } catch {}
    }
  });
}

// Verify host token and delete atomically under the room lock.
export async function verifyAndDelete(
  roomCode: string,
  hostToken: string,
): Promise<{ found: boolean; authorized: boolean }> {
  return withRoomLock(roomCode, async () => {
    const p = statePath(roomCode);
    if (!fs.existsSync(p)) return { found: false, authorized: false };
    let state: GameState;
    try { state = readStateFile(p); } catch { return { found: false, authorized: false }; }
    if (state.hostToken !== hostToken) return { found: true, authorized: false };
    for (const file of [p, p + '.backup', p + '.tmp']) {
      try { fs.unlinkSync(file); } catch {}
    }
    return { found: true, authorized: true };
  });
}

export async function loadAndUpdate(
  roomCode: string,
  updater: (state: GameState) => GameState,
  options?: { notify?: boolean },
): Promise<GameState | null> {
  const result = await withRoomLock(roomCode, async () => {
    const p = statePath(roomCode);
    if (!fs.existsSync(p)) return null;
    let state: GameState;
    try {
      state = readStateFile(p);
    } catch {
      return null;
    }
    const next = updater(state);
    const tmp  = p + '.tmp';
    fs.writeFileSync(tmp, encryptState(JSON.stringify(next)), 'utf-8');
    if (fs.existsSync(p)) fs.copyFileSync(p, p + '.backup');
    fs.renameSync(tmp, p);
    return next;
  });

  if (result && options?.notify !== false) {
    roomEvents.emit(`update:${roomCode}`, result);
  }

  return result;
}

// ── TTL cleanup ─────────────────────────────────────────────────────────────

function cleanupOldGames() {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(STATE_DIR)
      .filter(f => f.endsWith('.json') && !f.includes('.backup') && !f.includes('.tmp'));
    for (const file of files) {
      try {
        const p     = path.join(STATE_DIR, file);
        const state = readStateFile(p);
        if (state.createdAt < cutoff) {
          for (const f of [p, p + '.backup', p + '.tmp']) {
            try { fs.unlinkSync(f); } catch {}
          }
        }
      } catch {}
    }
  } catch {}
}

cleanupOldGames();
setInterval(cleanupOldGames, 60 * 60 * 1000);
