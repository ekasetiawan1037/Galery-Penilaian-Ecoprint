import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  BASE_ARTWORK_CATALOG,
  type ArtworkMetadataOverride,
  type AssessmentSubmission,
  type DriveArchiveConfig,
  type PhotoKind,
} from '../src/shared/ecoprint.ts';

export interface PersistedDatabase {
  submissions: AssessmentSubmission[];
  passwords: Record<string, string>;
  tokenSecret: string;
  artworksMeta: Record<string, ArtworkMetadataOverride>;
  driveConfig: DriveArchiveConfig;
  revision?: number;
  updatedAt: string;
}

export interface StorageStatusInfo {
  isVercel: boolean;
  storagePersistent: boolean;
  storageProvider: 'local-disk' | 'upstash-redis' | 'vercel-tmp';
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SMPBHATUR0707';

const isVercelEnv =
  Boolean(process.env.VERCEL) ||
  Boolean(process.env.VERCEL_ENV) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

function resolveDataDir(): string {
  if (isVercelEnv) {
    return '/tmp/ecoprint-data';
  }
  const localDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    fs.accessSync(localDir, fs.constants.W_OK);
    return localDir;
  } catch {
    return '/tmp/ecoprint-data';
  }
}

export const DATA_DIR = resolveDataDir();
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const DB_FILE = path.join(DATA_DIR, 'ecoprint-db.json');

function getRedisConfig(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  if (url && token) {
    return { url: url.replace(/\/$/, ''), token };
  }
  return null;
}

async function redisCommand<T = unknown>(args: (string | number)[]): Promise<T | null> {
  const cfg = getRedisConfig();
  if (!cfg) return null;
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`Redis REST error (${res.status})`);
  }
  const data = (await res.json()) as { result?: T; error?: string };
  if (data.error) {
    throw new Error(data.error);
  }
  return data.result ?? null;
}

export function getStorageStatus(): StorageStatusInfo {
  const hasRedis = Boolean(getRedisConfig());
  if (hasRedis) {
    return {
      isVercel: isVercelEnv,
      storagePersistent: true,
      storageProvider: 'upstash-redis',
    };
  }
  if (isVercelEnv || DATA_DIR.startsWith('/tmp')) {
    return {
      isVercel: isVercelEnv,
      storagePersistent: false,
      storageProvider: 'vercel-tmp',
    };
  }
  return {
    isVercel: false,
    storagePersistent: true,
    storageProvider: 'local-disk',
  };
}

export function defaultDriveConfig(): DriveArchiveConfig {
  return {
    driveFolderId: null,
    driveFolderUrl: null,
    driveOwnerEmail: null,
    driveOpenAccessStatus: null,
    classFolderIds: {},
    manifestFileId: null,
    csvFileId: null,
    driveWebhookUrl: null,
    lastSyncedAt: null,
  };
}

export interface ActiveDriveSession {
  accessToken: string;
  ownerEmail: string | null;
  expiresAt: number;
}

const DRIVE_SESSION_TTL_MS = 50 * 60 * 1000; // 50 minutes
const DRIVE_SESSION_REDIS_KEY = 'ecoprint:drive_session';
let memoryDriveSession: ActiveDriveSession | null = null;

export async function setActiveDriveSession(
  accessToken: string,
  ownerEmail: string | null = null,
): Promise<void> {
  const session: ActiveDriveSession = {
    accessToken,
    ownerEmail,
    expiresAt: Date.now() + DRIVE_SESSION_TTL_MS,
  };
  memoryDriveSession = session;
  if (getRedisConfig()) {
    await redisCommand([
      'SET',
      DRIVE_SESSION_REDIS_KEY,
      JSON.stringify(session),
      'EX',
      Math.floor(DRIVE_SESSION_TTL_MS / 1000),
    ]).catch(() => {});
  }
}

export async function getActiveDriveSession(): Promise<ActiveDriveSession | null> {
  if (memoryDriveSession && memoryDriveSession.expiresAt > Date.now() + 15_000) {
    return memoryDriveSession;
  }
  memoryDriveSession = null;

  if (getRedisConfig()) {
    try {
      const raw = await redisCommand<string>(['GET', DRIVE_SESSION_REDIS_KEY]);
      if (raw) {
        const parsed = JSON.parse(raw) as ActiveDriveSession;
        if (parsed.accessToken && parsed.expiresAt > Date.now() + 15_000) {
          memoryDriveSession = parsed;
          return parsed;
        }
      }
    } catch {
      // Ignore transient Redis read error
    }
  }

  return null;
}

export async function clearActiveDriveSession(): Promise<void> {
  memoryDriveSession = null;
  if (getRedisConfig()) {
    await redisCommand(['DEL', DRIVE_SESSION_REDIS_KEY]).catch(() => {});
  }
}

function ensureDirectories(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CHUNKS_DIR)) {
    fs.mkdirSync(CHUNKS_DIR, { recursive: true });
  }
}

/**
 * Deterministic initial passwords & token secret derived from ADMIN_PASSWORD
 * so all serverless instances on Vercel always share matching 52 group passwords
 * and HMAC tokens even on cold starts before external KV is configured.
 */
export function generateDeterministicTokenSecret(): string {
  return crypto
    .createHmac('sha256', ADMIN_PASSWORD)
    .update('ECOPRINT_TOKEN_SECRET_V1')
    .digest('hex');
}

export function generateDeterministicGroupPasswords(): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};

  for (const group of BASE_ARTWORK_CATALOG) {
    let attempt = 0;
    let code = '';
    while (!code || used.has(code)) {
      const digest = crypto
        .createHmac('sha256', ADMIN_PASSWORD)
        .update(`ECOPRINT_PW_V1:${group.groupId}:${attempt}`)
        .digest();
      let candidate = '';
      for (let i = 0; i < 6; i++) {
        candidate += PASSWORD_ALPHABET[digest[i] % PASSWORD_ALPHABET.length];
      }
      code = candidate;
      attempt++;
    }
    used.add(code);
    map[group.groupId] = code;
  }

  return map;
}

export function generateRandomGroupPasswords(): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};

  for (const group of BASE_ARTWORK_CATALOG) {
    let code = '';
    while (!code || used.has(code)) {
      let rand = '';
      for (let i = 0; i < 6; i++) {
        const idx = crypto.randomInt(0, PASSWORD_ALPHABET.length);
        rand += PASSWORD_ALPHABET[idx];
      }
      code = rand;
    }
    used.add(code);
    map[group.groupId] = code;
  }

  return map;
}

function normalizeParsedDb(parsed: Partial<PersistedDatabase>): {
  db: PersistedDatabase;
  changed: boolean;
} {
  let changed = false;

  const submissions = Array.isArray(parsed.submissions) ? parsed.submissions : [];
  if (!Array.isArray(parsed.submissions)) changed = true;

  let passwords = parsed.passwords ?? {};
  const allHavePassword = BASE_ARTWORK_CATALOG.every(
    (g) => typeof passwords[g.groupId] === 'string' && passwords[g.groupId].length >= 4,
  );
  if (!allHavePassword) {
    passwords = generateDeterministicGroupPasswords();
    changed = true;
  }

  const tokenSecret =
    typeof parsed.tokenSecret === 'string' && parsed.tokenSecret.length >= 16
      ? parsed.tokenSecret
      : generateDeterministicTokenSecret();
  if (tokenSecret !== parsed.tokenSecret) changed = true;

  const artworksMeta =
    parsed.artworksMeta && typeof parsed.artworksMeta === 'object'
      ? parsed.artworksMeta
      : {};

  const driveConfig =
    parsed.driveConfig && typeof parsed.driveConfig === 'object'
      ? { ...defaultDriveConfig(), ...parsed.driveConfig }
      : defaultDriveConfig();

  return {
    db: {
      submissions,
      passwords,
      tokenSecret,
      artworksMeta,
      driveConfig,
      revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    },
    changed,
  };
}

function createInitialDb(): PersistedDatabase {
  // When running on Vercel (/tmp), seed initial passwords/driveConfig from bundled data/ecoprint-db.json if present
  const bundledDbPath = path.resolve(process.cwd(), 'data', 'ecoprint-db.json');
  if (bundledDbPath !== DB_FILE && fs.existsSync(bundledDbPath)) {
    try {
      const raw = fs.readFileSync(bundledDbPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedDatabase>;
      return normalizeParsedDb(parsed).db;
    } catch {
      // Fallback to deterministic fresh DB
    }
  }

  return {
    submissions: [],
    passwords: generateDeterministicGroupPasswords(),
    tokenSecret: generateDeterministicTokenSecret(),
    artworksMeta: {},
    driveConfig: defaultDriveConfig(),
    revision: 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadDatabase(): Promise<PersistedDatabase> {
  ensureDirectories();

  const redis = getRedisConfig();
  if (redis) {
    try {
      const rawRedis = await redisCommand<string>(['GET', 'ecoprint:db']);
      if (rawRedis) {
        const parsed = JSON.parse(rawRedis) as Partial<PersistedDatabase>;
        const { db, changed } = normalizeParsedDb(parsed);
        if (changed) {
          await saveDatabase(db);
        }
        return db;
      }
    } catch {
      // Fallback to local file if Redis transiently unreachable
    }
  }

  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialDb();
    ensureDirectories();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    if (getRedisConfig()) {
      await redisCommand(['SET', 'ecoprint:db', JSON.stringify(initial, null, 2)]).catch(() => {});
    }
    return initial;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedDatabase>;
    const { db, changed } = normalizeParsedDb(parsed);
    if (changed) {
      await saveDatabase(db);
    }
    return db;
  } catch {
    const fallback = createInitialDb();
    await saveDatabase(fallback);
    return fallback;
  }
}

export async function saveDatabase(db: PersistedDatabase): Promise<void> {
  ensureDirectories();
  db.revision = (db.revision ?? 0) + 1;
  db.updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(db, null, 2);
  fs.writeFileSync(DB_FILE, serialized, 'utf-8');

  if (getRedisConfig()) {
    await redisCommand(['SET', 'ecoprint:db', serialized]).catch(() => {});
  }
}

const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp', 'heic', 'avif', 'gif', 'bmp'] as const;

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

function diskBaseName(groupId: string, kind: PhotoKind): string {
  return kind === 'group' ? `${groupId}_kelompok` : groupId;
}

function redisFileKey(groupId: string, kind: PhotoKind): string {
  return kind === 'group' ? `ecoprint:groupfile:${groupId}` : `ecoprint:file:${groupId}`;
}

export async function saveUploadedFile(
  groupId: string,
  ext: string,
  mimeType: string,
  buffer: Buffer,
  kind: PhotoKind = 'artwork',
): Promise<void> {
  ensureDirectories();
  const baseName = diskBaseName(groupId, kind);
  for (const oldExt of IMAGE_EXTENSIONS) {
    const oldPath = path.join(UPLOADS_DIR, `${baseName}.${oldExt}`);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  }
  const filePath = path.join(UPLOADS_DIR, `${baseName}.${ext}`);
  fs.writeFileSync(filePath, buffer);

  if (getRedisConfig()) {
    const payload = JSON.stringify({
      ext,
      mimeType,
      base64: buffer.toString('base64'),
    });
    await redisCommand(['SET', redisFileKey(groupId, kind), payload]);
  }
}

export async function readUploadedFile(
  groupId: string,
  kind: PhotoKind = 'artwork',
): Promise<{
  buffer: Buffer;
  mimeType: string;
  ext: string;
} | null> {
  ensureDirectories();
  const baseName = diskBaseName(groupId, kind);
  for (const ext of IMAGE_EXTENSIONS) {
    const filePath = path.join(UPLOADS_DIR, `${baseName}.${ext}`);
    if (fs.existsSync(filePath)) {
      return {
        buffer: fs.readFileSync(filePath),
        mimeType: EXT_TO_MIME[ext] ?? 'image/jpeg',
        ext,
      };
    }
  }

  if (getRedisConfig()) {
    try {
      const raw = await redisCommand<string>(['GET', redisFileKey(groupId, kind)]);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          ext: string;
          mimeType: string;
          base64: string;
        };
        const buffer = Buffer.from(parsed.base64, 'base64');
        // Cache to local /tmp for subsequent fast reads on warm container
        fs.writeFileSync(path.join(UPLOADS_DIR, `${baseName}.${parsed.ext}`), buffer);
        return {
          buffer,
          mimeType: parsed.mimeType || EXT_TO_MIME[parsed.ext] || 'image/jpeg',
          ext: parsed.ext,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function deleteUploadedFile(
  groupId: string,
  kind: PhotoKind | 'all' = 'artwork',
): Promise<void> {
  ensureDirectories();
  const targets: PhotoKind[] = kind === 'all' ? ['artwork', 'group'] : [kind];
  for (const targetKind of targets) {
    const baseName = diskBaseName(groupId, targetKind);
    for (const ext of IMAGE_EXTENSIONS) {
      const filePath = path.join(UPLOADS_DIR, `${baseName}.${ext}`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    if (getRedisConfig()) {
      await redisCommand(['DEL', redisFileKey(groupId, targetKind)]).catch(() => {});
    }
  }
}

export async function saveUploadChunk(
  groupId: string,
  uploadId: string,
  chunkIndex: number,
  chunkBase64: string,
): Promise<void> {
  ensureDirectories();
  const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
  const chunkKey = `ecoprint:chunk:${groupId}:${safeId}:${chunkIndex}`;
  if (getRedisConfig()) {
    await redisCommand(['SET', chunkKey, chunkBase64, 'EX', 600]);
  } else {
    const dir = path.join(CHUNKS_DIR, `${groupId}_${safeId}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, `${chunkIndex}.b64`), chunkBase64, 'utf-8');
  }
}

export async function assembleUploadChunks(
  groupId: string,
  uploadId: string,
  totalChunks: number,
): Promise<Buffer> {
  ensureDirectories();
  const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
  const buffers: Buffer[] = [];
  const hasRedis = Boolean(getRedisConfig());
  const dir = path.join(CHUNKS_DIR, `${groupId}_${safeId}`);

  for (let i = 0; i < totalChunks; i++) {
    let b64: string | null = null;
    if (hasRedis) {
      b64 = await redisCommand<string>(['GET', `ecoprint:chunk:${groupId}:${safeId}:${i}`]);
      await redisCommand(['DEL', `ecoprint:chunk:${groupId}:${safeId}:${i}`]).catch(() => {});
    } else {
      const p = path.join(dir, `${i}.b64`);
      if (fs.existsSync(p)) {
        b64 = fs.readFileSync(p, 'utf-8');
        fs.unlinkSync(p);
      }
    }
    if (!b64) {
      throw new Error(`Bagian upload #${i + 1} tidak ditemukan. Silakan ulangi upload foto.`);
    }
    buffers.push(Buffer.from(b64, 'base64'));
  }

  if (!hasRedis && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return Buffer.concat(buffers);
}
