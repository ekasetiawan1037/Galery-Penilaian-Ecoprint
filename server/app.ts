import crypto from 'crypto';
import express from 'express';
import {
  BASE_ARTWORK_CATALOG,
  type AssessmentSubmission,
  type DriveArchiveConfig,
  type GroupPasswordItem,
  type RankedVoteInput,
  buildCatalogWithOverrides,
  buildLockedSubmission,
  computeRecapitulation,
  generateAdditionalDemoSubmissions,
  getGroupById,
  validateAssessmentSubmission,
} from '../src/shared/ecoprint.ts';
import {
  deleteDriveFile,
  ensureFolderOpenAccess,
  ensureRootFolder,
  listDriveFolderFilesRecursive,
  runFullDriveSync,
  ServerDriveApiError,
} from './driveSync.ts';
import {
  type PersistedDatabase,
  assembleUploadChunks,
  deleteUploadedFile,
  generateRandomGroupPasswords,
  getStorageStatus,
  loadDatabase,
  readUploadedFile,
  saveDatabase,
  saveUploadChunk,
  saveUploadedFile,
} from './storage.ts';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SMPBHATUR0707';

function signGroupToken(groupId: string, password: string, secret: string): string {
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(`${groupId}:${password}`)
    .digest('hex');
  return `${groupId}.${hmac}`;
}

function verifyGroupToken(token: string | undefined, db: PersistedDatabase): string | null {
  if (!token) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const groupId = token.slice(0, dotIdx);
  const expectedPassword = db.passwords[groupId];
  if (!expectedPassword) return null;

  const expectedToken = signGroupToken(groupId, expectedPassword, db.tokenSecret);
  if (token.length !== expectedToken.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
  return ok ? groupId : null;
}

function signAdminToken(secret: string): string {
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(`ADMIN:${ADMIN_PASSWORD}`)
    .digest('hex');
  return `admin.${hmac}`;
}

function verifyAdminToken(token: string | undefined, db: PersistedDatabase): boolean {
  if (!token) return false;
  const expected = signAdminToken(db.tokenSecret);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function extractToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const customHeader = req.headers['x-group-token'];
  if (typeof customHeader === 'string') return customHeader.trim();
  return undefined;
}

function buildApiState(db: PersistedDatabase) {
  const catalog = buildCatalogWithOverrides(db.artworksMeta);
  return {
    catalog,
    submissions: db.submissions,
    recapitulation: computeRecapitulation(db.submissions, catalog),
    driveConfig: db.driveConfig,
    revision: db.revision ?? 0,
    updatedAt: db.updatedAt,
    runtimeInfo: getStorageStatus(),
  };
}

function buildPasswordList(db: PersistedDatabase): GroupPasswordItem[] {
  return BASE_ARTWORK_CATALOG.map((g) => ({
    groupId: g.groupId,
    className: g.className,
    grade: g.grade,
    groupNumber: g.groupNumber,
    password: db.passwords[g.groupId],
  }));
}

function mimeTypeToExtension(mimeType: string, fileName?: string): string {
  const lower = mimeType.toLowerCase();
  if (lower === 'image/png') return 'png';
  if (lower === 'image/webp') return 'webp';
  if (lower === 'image/heic' || lower === 'image/heif') return 'heic';
  if (lower === 'image/avif') return 'avif';
  if (lower === 'image/gif') return 'gif';
  if (lower === 'image/bmp') return 'bmp';
  if (lower === 'image/jpeg' || lower === 'image/jpg') return 'jpg';
  const extFromName = fileName?.split('.').pop()?.toLowerCase();
  if (
    extFromName &&
    ['png', 'webp', 'heic', 'heif', 'avif', 'gif', 'bmp', 'jpg', 'jpeg'].includes(extFromName)
  ) {
    return extFromName === 'jpeg' ? 'jpg' : extFromName === 'heif' ? 'heic' : extFromName;
  }
  return 'jpg';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  jpg: 'image/jpeg',
};

export function createApiApp(): express.Express {
  const app = express();
  // Allow single-request payloads locally (35mb); large files on Vercel auto-chunk under 4.5MB
  app.use(express.json({ limit: '35mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      runtime: getStorageStatus(),
    });
  });

  app.get('/api/state', async (_req, res) => {
    const db = await loadDatabase();
    res.json(buildApiState(db));
  });

  app.post('/api/auth/login', async (req, res) => {
    const { groupId, password } = req.body as {
      groupId?: string;
      password?: string;
    };

    if (!groupId || !password) {
      res.status(400).json({ error: 'Pilih kelompok dan masukkan password.' });
      return;
    }

    const group = getGroupById(groupId);
    if (!group) {
      res.status(404).json({ error: 'Kelompok tidak ditemukan.' });
      return;
    }

    const db = await loadDatabase();
    const expected = db.passwords[groupId];
    const normalizedInput = password.trim().toUpperCase();

    if (!expected || normalizedInput !== expected.toUpperCase()) {
      res.status(401).json({
        error: `Password salah untuk Kelompok ${groupId}. Periksa kembali kartu password kelompok Anda.`,
      });
      return;
    }

    const token = signGroupToken(groupId, expected, db.tokenSecret);
    res.json({
      token,
      groupId,
    });
  });

  app.get('/api/auth/session', async (req, res) => {
    const db = await loadDatabase();
    const token = extractToken(req);
    const verifiedGroupId = verifyGroupToken(token, db);
    if (!verifiedGroupId) {
      res.status(401).json({ valid: false });
      return;
    }
    res.json({ valid: true, groupId: verifiedGroupId });
  });

  app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body as { password?: string };
    if (!password) {
      res.status(400).json({ error: 'Masukkan password admin guru.' });
      return;
    }

    if (password.trim() !== ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Password admin salah.' });
      return;
    }

    const db = await loadDatabase();
    const token = signAdminToken(db.tokenSecret);
    res.json({ token });
  });

  app.get('/api/admin/session', async (req, res) => {
    const db = await loadDatabase();
    const valid = verifyAdminToken(extractToken(req), db);
    if (!valid) {
      res.status(401).json({ valid: false });
      return;
    }
    res.json({ valid: true });
  });

  // Chunk upload endpoint so original files > 4.5MB (up to 25MB) bypass Vercel Serverless 4.5MB payload limit
  app.post('/api/artworks/:groupId/photo-chunk', async (req, res) => {
    const { groupId } = req.params;
    const db = await loadDatabase();
    const verifiedGroupId = verifyGroupToken(extractToken(req), db);

    if (!verifiedGroupId || verifiedGroupId !== groupId) {
      res.status(401).json({
        error: `Anda harus masuk menggunakan password Kelompok ${groupId}.`,
      });
      return;
    }

    const { uploadId, chunkIndex, totalChunks, chunkBase64 } = req.body as {
      uploadId?: string;
      chunkIndex?: number;
      totalChunks?: number;
      chunkBase64?: string;
    };

    if (
      !uploadId ||
      typeof chunkIndex !== 'number' ||
      typeof totalChunks !== 'number' ||
      !chunkBase64 ||
      chunkIndex < 0 ||
      chunkIndex >= totalChunks ||
      totalChunks > 20
    ) {
      res.status(400).json({ error: 'Data potongan file tidak valid.' });
      return;
    }

    try {
      await saveUploadChunk(groupId, uploadId, chunkIndex, chunkBase64);
      res.json({ ok: true, chunkIndex });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menyimpan potongan foto.',
      });
    }
  });

  // Upload original-size artwork photo and/or edit memberNames, artworkTitle & leaves for the authenticated group
  app.post('/api/artworks/:groupId/photo', async (req, res) => {
    const { groupId } = req.params;
    const db = await loadDatabase();
    const verifiedGroupId = verifyGroupToken(extractToken(req), db);

    if (!verifiedGroupId || verifiedGroupId !== groupId) {
      res.status(401).json({
        error: `Anda harus masuk menggunakan password Kelompok ${groupId} untuk mengedit karya atau mengupload foto ini.`,
      });
      return;
    }

    const {
      imageDataUrl,
      uploadId,
      totalChunks,
      originalFileName,
      originalMimeType,
      memberNames,
      artworkTitle,
      technique,
      leaves,
      fabric,
      mordant,
      description,
      driveFileId,
      driveWebViewLink,
      driveSyncedAt,
      driveFolderId,
      driveFolderUrl,
      driveOpenAccessStatus,
    } = req.body as {
      imageDataUrl?: string;
      uploadId?: string;
      totalChunks?: number;
      originalFileName?: string;
      originalMimeType?: string;
      memberNames?: string;
      artworkTitle?: string;
      technique?: string;
      leaves?: string;
      fabric?: string;
      mordant?: string;
      description?: string;
      driveFileId?: string | null;
      driveWebViewLink?: string | null;
      driveSyncedAt?: string | null;
      driveFolderId?: string | null;
      driveFolderUrl?: string | null;
      driveOpenAccessStatus?: DriveArchiveConfig['driveOpenAccessStatus'];
    };

    const existingMeta = db.artworksMeta[groupId] ?? {};
    let photoUrl = existingMeta.photoUrl ?? null;
    let photoUpdatedAt = existingMeta.photoUpdatedAt ?? null;
    let savedOriginalName = existingMeta.originalFileName ?? null;
    let savedOriginalSize = existingMeta.originalFileSize ?? null;
    let savedOriginalMime = existingMeta.originalMimeType ?? null;
    let nextDriveFileId = existingMeta.driveFileId ?? null;
    let nextDriveWebViewLink = existingMeta.driveWebViewLink ?? null;
    let nextDriveSyncedAt = existingMeta.driveSyncedAt ?? null;

    if (imageDataUrl || (uploadId && typeof totalChunks === 'number' && totalChunks > 0)) {
      let buffer: Buffer;
      let detectedMime: string;
      let ext: string;

      if (uploadId && typeof totalChunks === 'number' && totalChunks > 0) {
        const candidateMime = (originalMimeType || 'image/jpeg').toLowerCase();
        const isAllowedImage =
          candidateMime.startsWith('image/') ||
          (candidateMime === 'application/octet-stream' &&
            /\.(jpg|jpeg|png|webp|heic|heif|avif|gif|bmp)$/i.test(originalFileName || ''));
        if (!isAllowedImage) {
          res.status(400).json({
            error: 'Format file bukan gambar yang didukung. Gunakan JPG, PNG, WebP, atau HEIC.',
          });
          return;
        }
        ext = mimeTypeToExtension(candidateMime, originalFileName);
        detectedMime = candidateMime.startsWith('image/')
          ? candidateMime
          : MIME_BY_EXT[ext] ?? 'image/jpeg';
        try {
          buffer = await assembleUploadChunks(groupId, uploadId, totalChunks);
        } catch (err) {
          res.status(400).json({
            error: err instanceof Error ? err.message : 'Gagal menggabungkan file foto.',
          });
          return;
        }
      } else {
        const match = (imageDataUrl || '').match(/^data:([^,]*);base64,([A-Za-z0-9+/=\s]+)$/i);
        if (!match) {
          res.status(400).json({
            error: 'Format gambar tidak valid. Gunakan file gambar JPG, PNG, WebP, atau HEIC.',
          });
          return;
        }
        const dataUrlHeader = match[1] || '';
        const dataUrlMime = (dataUrlHeader.split(';')[0] || '').trim().toLowerCase();
        const candidateMime = (originalMimeType || dataUrlMime || 'image/jpeg').toLowerCase();
        const isAllowedImage =
          candidateMime.startsWith('image/') ||
          (candidateMime === 'application/octet-stream' &&
            /\.(jpg|jpeg|png|webp|heic|heif|avif|gif|bmp)$/i.test(originalFileName || ''));
        if (!isAllowedImage) {
          res.status(400).json({
            error: 'Format file bukan gambar yang didukung. Gunakan JPG, PNG, WebP, atau HEIC.',
          });
          return;
        }
        ext = mimeTypeToExtension(candidateMime, originalFileName);
        detectedMime = candidateMime.startsWith('image/')
          ? candidateMime
          : MIME_BY_EXT[ext] ?? 'image/jpeg';
        buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
      }

      if (buffer.byteLength > 25 * 1024 * 1024) {
        res.status(400).json({
          error: 'Ukuran file foto melebihi batas 25 MB.',
        });
        return;
      }

      await saveUploadedFile(groupId, ext, detectedMime, buffer);

      const fileName = `${groupId}.${ext}`;
      const ts = Date.now();
      photoUrl = `/uploads/${fileName}?v=${ts}`;
      photoUpdatedAt = new Date().toISOString();
      savedOriginalName = originalFileName?.slice(0, 140) || fileName;
      savedOriginalSize = buffer.byteLength;
      savedOriginalMime = detectedMime;

      nextDriveFileId = driveFileId ?? null;
      nextDriveWebViewLink = driveWebViewLink ?? null;
      nextDriveSyncedAt = driveSyncedAt ?? null;
    }

    if (driveFolderId && driveFolderUrl) {
      db.driveConfig = {
        ...db.driveConfig,
        driveFolderId,
        driveFolderUrl,
        ...(driveOpenAccessStatus !== undefined ? { driveOpenAccessStatus } : {}),
        lastSyncedAt: new Date().toISOString(),
      };
    }

    db.artworksMeta[groupId] = {
      ...existingMeta,
      photoUrl,
      photoUpdatedAt,
      originalFileName: savedOriginalName,
      originalFileSize: savedOriginalSize,
      originalMimeType: savedOriginalMime,
      driveFileId: nextDriveFileId,
      driveWebViewLink: nextDriveWebViewLink,
      driveSyncedAt: nextDriveSyncedAt,
      ...(memberNames !== undefined ? { memberNames: memberNames.slice(0, 160) } : {}),
      ...(artworkTitle !== undefined ? { artworkTitle: artworkTitle.slice(0, 80) } : {}),
      ...(technique !== undefined ? { technique: technique.slice(0, 50) } : {}),
      ...(leaves !== undefined ? { leaves: leaves.slice(0, 120) } : {}),
      ...(fabric !== undefined ? { fabric: fabric.slice(0, 60) } : {}),
      ...(mordant !== undefined ? { mordant: mordant.slice(0, 60) } : {}),
      ...(description !== undefined ? { description: description.slice(0, 260) } : {}),
    };

    await saveDatabase(db);
    res.json({
      state: buildApiState(db),
    });
  });

  app.delete('/api/artworks/:groupId/photo', async (req, res) => {
    const { groupId } = req.params;
    const db = await loadDatabase();
    const verifiedGroupId = verifyGroupToken(extractToken(req), db);

    if (!verifiedGroupId || verifiedGroupId !== groupId) {
      res.status(401).json({
        error: `Anda harus masuk menggunakan password Kelompok ${groupId} untuk menghapus foto ini.`,
      });
      return;
    }

    const existingMeta = db.artworksMeta[groupId] ?? {};
    const driveHeader = req.headers['x-drive-token'];
    const driveToken =
      typeof driveHeader === 'string' && driveHeader.trim() ? driveHeader.trim() : null;
    if (driveToken && existingMeta.driveFileId) {
      await deleteDriveFile(driveToken, existingMeta.driveFileId).catch(() => {});
    }

    await deleteUploadedFile(groupId);

    db.artworksMeta[groupId] = {
      ...existingMeta,
      photoUrl: null,
      photoUpdatedAt: null,
      originalFileName: null,
      originalFileSize: null,
      originalMimeType: null,
      driveFileId: null,
      driveWebViewLink: null,
      driveSyncedAt: null,
    };
    await saveDatabase(db);

    res.json({ state: buildApiState(db) });
  });

  // Serve uploaded artwork photos seamlessly across disk/tmp and Upstash Redis
  app.get('/uploads/:filename', async (req, res) => {
    const { filename } = req.params;
    const dotIdx = filename.lastIndexOf('.');
    const groupId = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
    if (!getGroupById(groupId)) {
      res.status(404).end();
      return;
    }

    const fileData = await readUploadedFile(groupId);
    if (!fileData) {
      res.status(404).end();
      return;
    }

    const db = await loadDatabase();
    const meta = db.artworksMeta[groupId];
    res.setHeader('Content-Type', meta?.originalMimeType || fileData.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(fileData.buffer);
  });

  // Download exact original uploaded file (with Content-Disposition attachment)
  app.get('/api/artworks/:groupId/download-original', async (req, res) => {
    const { groupId } = req.params;
    const fileData = await readUploadedFile(groupId);
    if (!fileData) {
      res.status(404).json({ error: 'File asli belum tersedia di server.' });
      return;
    }
    const db = await loadDatabase();
    const meta = db.artworksMeta[groupId];
    const downloadName = meta?.originalFileName || `${groupId}.${fileData.ext}`;
    res.setHeader('Content-Type', meta?.originalMimeType || fileData.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadName.replace(/"/g, '')}"`,
    );
    res.send(fileData.buffer);
  });

  // Stream original uploaded file bytes for Admin Google Drive auto-sync
  app.get('/api/admin/original-file/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak.' });
      return;
    }

    const fileData = await readUploadedFile(groupId);
    if (!fileData) {
      res.status(404).json({ error: 'File asli belum tersedia di server.' });
      return;
    }

    const meta = db.artworksMeta[groupId];
    res.setHeader('Content-Type', meta?.originalMimeType || fileData.mimeType);
    if (meta?.originalFileName) {
      res.setHeader('X-Original-Filename', encodeURIComponent(meta.originalFileName));
    }
    res.send(fileData.buffer);
  });

  app.post('/api/admin/drive-sync', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login Admin Guru.' });
      return;
    }

    const driveTokenHeader = req.headers['x-drive-token'];
    const driveAccessToken =
      typeof driveTokenHeader === 'string' ? driveTokenHeader.trim() : '';
    if (!driveAccessToken) {
      res.status(400).json({ error: 'Token Google Drive tidak disertakan.' });
      return;
    }

    const { ownerEmail, applyOpenAccess = true, forceArchiveDocs = false } = req.body as {
      ownerEmail?: string | null;
      applyOpenAccess?: boolean;
      forceArchiveDocs?: boolean;
    };

    try {
      const catalog = buildCatalogWithOverrides(db.artworksMeta);
      const recapitulation = computeRecapitulation(db.submissions, catalog);

      const syncResult = await runFullDriveSync({
        accessToken: driveAccessToken,
        ownerEmail,
        driveConfig: db.driveConfig,
        catalog,
        recapitulation,
        readUploadedFileBuffer: async (gid) => {
          const data = await readUploadedFile(gid);
          return data ? { buffer: data.buffer, mimeType: data.mimeType } : null;
        },
        applyOpenAccess,
        forceArchiveDocs,
      });

      db.driveConfig = syncResult.driveConfig;
      for (const item of syncResult.syncedItems) {
        const prev = db.artworksMeta[item.groupId] ?? {};
        db.artworksMeta[item.groupId] = {
          ...prev,
          driveFileId: item.driveFileId,
          driveWebViewLink: item.driveWebViewLink,
          driveSyncedAt: item.driveSyncedAt,
        };
      }
      await saveDatabase(db);

      res.json({
        state: buildApiState(db),
        syncedCount: syncResult.syncedItems.length,
        driveFiles: syncResult.driveFiles,
        openAccessMessage: syncResult.openAccessMessage ?? null,
      });
    } catch (err) {
      if (err instanceof ServerDriveApiError) {
        res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
          error: err.message,
          reason: err.reason ?? null,
          activationUrl: err.activationUrl ?? null,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menyinkronkan ke Google Drive.',
      });
    }
  });

  app.post('/api/admin/drive-open-access', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak.' });
      return;
    }

    const driveTokenHeader = req.headers['x-drive-token'];
    const driveAccessToken =
      typeof driveTokenHeader === 'string' ? driveTokenHeader.trim() : '';
    if (!driveAccessToken) {
      res.status(400).json({ error: 'Token Google Drive tidak disertakan.' });
      return;
    }

    const { ownerEmail } = req.body as { ownerEmail?: string | null };
    try {
      const rootFolder = await ensureRootFolder(
        driveAccessToken,
        db.driveConfig.driveFolderId,
        true,
      );
      const accessRes = await ensureFolderOpenAccess(driveAccessToken, rootFolder.id);
      for (const subId of Object.values(db.driveConfig.classFolderIds ?? {})) {
        if (subId) {
          await ensureFolderOpenAccess(driveAccessToken, subId).catch(() => {});
        }
      }
      db.driveConfig = {
        ...db.driveConfig,
        driveFolderId: rootFolder.id,
        driveFolderUrl: rootFolder.webViewLink,
        driveOwnerEmail: ownerEmail ?? db.driveConfig.driveOwnerEmail,
        driveOpenAccessStatus: accessRes.status,
        lastSyncedAt: new Date().toISOString(),
      };
      await saveDatabase(db);
      res.json({
        state: buildApiState(db),
        status: accessRes.status,
        message: accessRes.message ?? null,
      });
    } catch (err) {
      if (err instanceof ServerDriveApiError) {
        res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
          error: err.message,
          reason: err.reason ?? null,
          activationUrl: err.activationUrl ?? null,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal mengatur Open Access Drive.',
      });
    }
  });

  app.get('/api/admin/drive-files', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak.' });
      return;
    }

    const driveTokenHeader = req.headers['x-drive-token'];
    const driveAccessToken =
      typeof driveTokenHeader === 'string' ? driveTokenHeader.trim() : '';
    if (!driveAccessToken || !db.driveConfig.driveFolderId) {
      res.status(400).json({ error: 'Folder Google Drive belum terhubung.' });
      return;
    }

    try {
      const files = await listDriveFolderFilesRecursive(
        driveAccessToken,
        db.driveConfig.driveFolderId,
        db.driveConfig.classFolderIds ?? {},
      );
      res.json({ files });
    } catch (err) {
      if (err instanceof ServerDriveApiError) {
        res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
          error: err.message,
          reason: err.reason ?? null,
          activationUrl: err.activationUrl ?? null,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal membaca folder Drive.',
      });
    }
  });

  app.post('/api/admin/drive-folder', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak.' });
      return;
    }

    const {
      driveFolderId,
      driveFolderUrl,
      driveOwnerEmail,
      driveOpenAccessStatus,
      manifestFileId,
      csvFileId,
    } = req.body as {
      driveFolderId?: string;
      driveFolderUrl?: string;
      driveOwnerEmail?: string;
      driveOpenAccessStatus?: DriveArchiveConfig['driveOpenAccessStatus'];
      manifestFileId?: string | null;
      csvFileId?: string | null;
    };

    if (!driveFolderId || !driveFolderUrl) {
      res.status(400).json({ error: 'ID dan URL folder Drive wajib disertakan.' });
      return;
    }

    db.driveConfig = {
      ...db.driveConfig,
      driveFolderId,
      driveFolderUrl,
      driveOwnerEmail: driveOwnerEmail ?? db.driveConfig.driveOwnerEmail,
      driveOpenAccessStatus:
        driveOpenAccessStatus !== undefined
          ? driveOpenAccessStatus
          : db.driveConfig.driveOpenAccessStatus,
      manifestFileId:
        manifestFileId !== undefined ? manifestFileId : db.driveConfig.manifestFileId,
      csvFileId: csvFileId !== undefined ? csvFileId : db.driveConfig.csvFileId,
      lastSyncedAt: new Date().toISOString(),
    };
    await saveDatabase(db);
    res.json(buildApiState(db));
  });

  app.post('/api/admin/drive-sync-record', async (req, res) => {
    const db = await loadDatabase();
    const token = extractToken(req);
    const isAdmin = verifyAdminToken(token, db);
    const groupIdFromToken = verifyGroupToken(token, db);

    const { groupId, driveFileId, driveWebViewLink, manifestFileId } = req.body as {
      groupId?: string;
      driveFileId?: string;
      driveWebViewLink?: string;
      manifestFileId?: string | null;
    };

    if (!groupId || !driveFileId || !driveWebViewLink) {
      res.status(400).json({ error: 'Data sinkronisasi Drive tidak lengkap.' });
      return;
    }

    if (!isAdmin && groupIdFromToken !== groupId) {
      res.status(401).json({ error: 'Akses ditolak.' });
      return;
    }

    const existingMeta = db.artworksMeta[groupId] ?? {};
    db.artworksMeta[groupId] = {
      ...existingMeta,
      driveFileId,
      driveWebViewLink,
      driveSyncedAt: new Date().toISOString(),
    };
    if (manifestFileId !== undefined) {
      db.driveConfig.manifestFileId = manifestFileId;
    }
    db.driveConfig.lastSyncedAt = new Date().toISOString();
    await saveDatabase(db);

    res.json(buildApiState(db));
  });

  app.post('/api/assessments', async (req, res) => {
    const { evaluatorGroupId, votes } = req.body as {
      evaluatorGroupId?: string;
      votes?: RankedVoteInput[];
    };

    if (!evaluatorGroupId || !Array.isArray(votes)) {
      res.status(400).json({
        error: 'Permintaan tidak lengkap. Sertakan evaluatorGroupId dan 4 peringkat karya.',
      });
      return;
    }

    const db = await loadDatabase();
    const verifiedGroupId = verifyGroupToken(extractToken(req), db);
    if (!verifiedGroupId || verifiedGroupId !== evaluatorGroupId) {
      res.status(401).json({
        error: `Sesi tidak valid. Silakan masuk kembali menggunakan password Kelompok ${evaluatorGroupId}.`,
      });
      return;
    }

    const validation = validateAssessmentSubmission(evaluatorGroupId, votes, db.submissions);
    if (!validation.valid) {
      res.status(400).json({
        error: validation.error,
        code: validation.code,
      });
      return;
    }

    const lockedSubmission: AssessmentSubmission = buildLockedSubmission(
      evaluatorGroupId,
      votes,
      false,
    );
    db.submissions.push(lockedSubmission);
    await saveDatabase(db);

    res.status(201).json({
      submission: lockedSubmission,
      state: buildApiState(db),
    });
  });

  app.get('/api/admin/passwords', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login sebagai Admin Guru.' });
      return;
    }
    res.json({
      passwords: buildPasswordList(db),
      updatedAt: db.updatedAt,
    });
  });

  app.post('/api/admin/regenerate-passwords', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login sebagai Admin Guru.' });
      return;
    }
    db.passwords = generateRandomGroupPasswords();
    await saveDatabase(db);
    res.json({
      passwords: buildPasswordList(db),
      updatedAt: db.updatedAt,
    });
  });

  app.post('/api/admin/seed-demo', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login sebagai Admin Guru.' });
      return;
    }
    const count =
      typeof req.body?.count === 'number' ? Math.min(20, Math.max(1, req.body.count)) : 10;
    db.submissions = generateAdditionalDemoSubmissions(db.submissions, count);
    await saveDatabase(db);
    res.json(buildApiState(db));
  });

  app.post('/api/admin/reset', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login sebagai Admin Guru.' });
      return;
    }
    db.submissions = [];
    await saveDatabase(db);
    res.json(buildApiState(db));
  });

  app.post('/api/admin/unlock-group', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login sebagai Admin Guru.' });
      return;
    }
    const { groupId } = req.body as { groupId?: string };
    if (!groupId) {
      res.status(400).json({ error: 'Kode kelompok wajib diisi.' });
      return;
    }
    db.submissions = db.submissions.filter((s) => s.evaluatorGroupId !== groupId);
    await saveDatabase(db);
    res.json(buildApiState(db));
  });

  return app;
}
