import crypto from 'crypto';
import express from 'express';
import {
  BASE_ARTWORK_CATALOG,
  type AssessmentSubmission,
  type DriveArchiveConfig,
  type GroupPasswordItem,
  type PhotoKind,
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
  syncManifestViaAppsScriptWebhook,
  syncSingleGroupToDrive,
  uploadViaAppsScriptWebhook,
  writeDriveManifestAndCsv,
} from './driveSync.ts';
import {
  type PersistedDatabase,
  assembleUploadChunks,
  clearActiveDriveSession,
  deleteUploadedFile,
  generateRandomGroupPasswords,
  getActiveDriveSession,
  getStorageStatus,
  loadDatabase,
  readUploadedFile,
  saveDatabase,
  saveUploadChunk,
  saveUploadedFile,
  setActiveDriveSession,
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

async function buildApiState(db: PersistedDatabase) {
  const catalog = buildCatalogWithOverrides(db.artworksMeta);
  const driveSession = await getActiveDriveSession();
  return {
    catalog,
    submissions: db.submissions,
    recapitulation: computeRecapitulation(db.submissions, catalog),
    driveConfig: db.driveConfig,
    driveBridgeConnected: Boolean(driveSession || db.driveConfig.driveWebhookUrl),
    revision: db.revision ?? 0,
    updatedAt: db.updatedAt,
    runtimeInfo: getStorageStatus(),
  };
}

async function autoSyncManifestToDrive(
  db: PersistedDatabase,
  driveTokenOverride?: string | null,
): Promise<boolean> {
  const activeSession = await getActiveDriveSession();
  const accessToken = driveTokenOverride || activeSession?.accessToken || null;

  if (accessToken) {
    try {
      db.driveConfig = await writeDriveManifestAndCsv({
        accessToken,
        driveConfig: db.driveConfig,
        artworksMeta: db.artworksMeta,
        submissions: db.submissions,
        ownerEmail: activeSession?.ownerEmail ?? db.driveConfig.driveOwnerEmail,
      });
      return true;
    } catch (err) {
      if (err instanceof ServerDriveApiError && err.status === 401) {
        await clearActiveDriveSession();
      }
      // Fallback to webhook if configured
    }
  }

  const webhookUrl = db.driveConfig.driveWebhookUrl;
  if (webhookUrl) {
    try {
      const hookRes = await syncManifestViaAppsScriptWebhook(webhookUrl, {
        artworksMeta: db.artworksMeta,
        submissions: db.submissions,
        driveConfig: db.driveConfig,
      });
      db.driveConfig = {
        ...db.driveConfig,
        ...(hookRes.driveFolderId ? { driveFolderId: hookRes.driveFolderId } : {}),
        ...(hookRes.driveFolderUrl ? { driveFolderUrl: hookRes.driveFolderUrl } : {}),
        ...(hookRes.manifestFileId ? { manifestFileId: hookRes.manifestFileId } : {}),
        ...(hookRes.csvFileId ? { csvFileId: hookRes.csvFileId } : {}),
        lastSyncedAt: new Date().toISOString(),
      };
      return true;
    } catch {
      // Non-fatal: data remains safely stored in server DB
    }
  }

  return false;
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
    res.json(await buildApiState(db));
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

    // Auto-pull & merge latest archive from Google Drive if an active Drive session exists
    const headerDriveToken =
      typeof req.headers['x-drive-token'] === 'string' &&
      req.headers['x-drive-token'].trim()
        ? req.headers['x-drive-token'].trim()
        : null;
    const activeDriveSession = await getActiveDriveSession();
    const driveTokenToUse = headerDriveToken ?? activeDriveSession?.accessToken ?? null;

    let autoPulled = false;
    let pulledGroupsCount = 0;
    let pulledVotesCount = 0;
    let syncedCount = 0;

    if (driveTokenToUse) {
      try {
        if (headerDriveToken) {
          await setActiveDriveSession(
            headerDriveToken,
            activeDriveSession?.ownerEmail ?? db.driveConfig.driveOwnerEmail,
          );
        }
        const syncResult = await runFullDriveSync({
          accessToken: driveTokenToUse,
          ownerEmail: activeDriveSession?.ownerEmail ?? db.driveConfig.driveOwnerEmail,
          driveConfig: db.driveConfig,
          artworksMeta: db.artworksMeta,
          submissions: db.submissions,
          readUploadedFileBuffer: async (gid, kind) => {
            const data = await readUploadedFile(gid, kind);
            return data ? { buffer: data.buffer, mimeType: data.mimeType } : null;
          },
          applyOpenAccess: false,
          forceArchiveDocs: true,
          pullFromDrive: true,
        });
        db.driveConfig = syncResult.driveConfig;
        db.artworksMeta = syncResult.mergedArtworksMeta;
        db.submissions = syncResult.mergedSubmissions;
        pulledGroupsCount = syncResult.pulledGroupsCount;
        pulledVotesCount = syncResult.pulledVotesCount;
        syncedCount = syncResult.syncedItems.length;
        autoPulled = true;
        await saveDatabase(db);
      } catch (err) {
        if (err instanceof ServerDriveApiError && err.status === 401) {
          await clearActiveDriveSession();
        }
      }
    }

    res.json({
      token,
      autoPulled,
      pulledGroupsCount,
      pulledVotesCount,
      syncedCount,
      state: await buildApiState(db),
    });
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
    const token = extractToken(req);
    const verifiedGroupId = verifyGroupToken(token, db);
    const isAdmin = verifyAdminToken(token, db);

    if (!isAdmin && (!verifiedGroupId || verifiedGroupId !== groupId)) {
      res.status(401).json({
        error: `Anda harus masuk menggunakan password Kelompok ${groupId} atau Admin Guru.`,
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

  async function resolveIncomingImageBuffer(params: {
    groupId: string;
    imageDataUrl?: string;
    uploadId?: string;
    totalChunks?: number;
    originalFileName?: string;
    originalMimeType?: string;
    defaultFileName: string;
  }): Promise<{
    buffer: Buffer;
    ext: string;
    mimeType: string;
    fileName: string;
  }> {
    const {
      groupId,
      imageDataUrl,
      uploadId,
      totalChunks,
      originalFileName,
      originalMimeType,
      defaultFileName,
    } = params;

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
        throw new Error(
          'Format file bukan gambar yang didukung. Gunakan JPG, PNG, WebP, atau HEIC.',
        );
      }
      ext = mimeTypeToExtension(candidateMime, originalFileName);
      detectedMime = candidateMime.startsWith('image/')
        ? candidateMime
        : MIME_BY_EXT[ext] ?? 'image/jpeg';
      buffer = await assembleUploadChunks(groupId, uploadId, totalChunks);
    } else {
      const match = (imageDataUrl || '').match(/^data:([^,]*);base64,([A-Za-z0-9+/=\s]+)$/i);
      if (!match) {
        throw new Error(
          'Format gambar tidak valid. Gunakan file gambar JPG, PNG, WebP, atau HEIC.',
        );
      }
      const dataUrlHeader = match[1] || '';
      const dataUrlMime = (dataUrlHeader.split(';')[0] || '').trim().toLowerCase();
      const candidateMime = (originalMimeType || dataUrlMime || 'image/jpeg').toLowerCase();
      const isAllowedImage =
        candidateMime.startsWith('image/') ||
        (candidateMime === 'application/octet-stream' &&
          /\.(jpg|jpeg|png|webp|heic|heif|avif|gif|bmp)$/i.test(originalFileName || ''));
      if (!isAllowedImage) {
        throw new Error(
          'Format file bukan gambar yang didukung. Gunakan JPG, PNG, WebP, atau HEIC.',
        );
      }
      ext = mimeTypeToExtension(candidateMime, originalFileName);
      detectedMime = candidateMime.startsWith('image/')
        ? candidateMime
        : MIME_BY_EXT[ext] ?? 'image/jpeg';
      buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    }

    if (buffer.byteLength > 25 * 1024 * 1024) {
      throw new Error('Ukuran file foto melebihi batas 25 MB.');
    }

    const fileName = originalFileName?.slice(0, 140) || `${defaultFileName}.${ext}`;
    return { buffer, ext, mimeType: detectedMime, fileName };
  }

  interface ArtworkSaveBody {
    imageDataUrl?: string;
    uploadId?: string;
    totalChunks?: number;
    originalFileName?: string;
    originalMimeType?: string;
    groupImageDataUrl?: string;
    groupUploadId?: string;
    groupTotalChunks?: number;
    groupOriginalFileName?: string;
    groupOriginalMimeType?: string;
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
  }

  async function processGroupArtworkSave(params: {
    db: PersistedDatabase;
    groupId: string;
    body: ArtworkSaveBody;
    headerDriveToken: string | null;
  }) {
    const { db, groupId, body, headerDriveToken } = params;
    const {
      imageDataUrl,
      uploadId,
      totalChunks,
      originalFileName,
      originalMimeType,
      groupImageDataUrl,
      groupUploadId,
      groupTotalChunks,
      groupOriginalFileName,
      groupOriginalMimeType,
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
    } = body;

    const hasNewArtworkPhoto = Boolean(
      imageDataUrl || (uploadId && typeof totalChunks === 'number' && totalChunks > 0),
    );
    const hasNewGroupPhoto = Boolean(
      groupImageDataUrl ||
        (groupUploadId && typeof groupTotalChunks === 'number' && groupTotalChunks > 0),
    );

    let decodedArtwork:
      | { buffer: Buffer; ext: string; mimeType: string; fileName: string }
      | null = null;
    let decodedGroup:
      | { buffer: Buffer; ext: string; mimeType: string; fileName: string }
      | null = null;

    if (hasNewArtworkPhoto) {
      decodedArtwork = await resolveIncomingImageBuffer({
        groupId,
        imageDataUrl,
        uploadId,
        totalChunks,
        originalFileName,
        originalMimeType,
        defaultFileName: groupId,
      });
    }
    if (hasNewGroupPhoto) {
      decodedGroup = await resolveIncomingImageBuffer({
        groupId,
        imageDataUrl: groupImageDataUrl,
        uploadId: groupUploadId,
        totalChunks: groupTotalChunks,
        originalFileName: groupOriginalFileName,
        originalMimeType: groupOriginalMimeType,
        defaultFileName: `${groupId}_kelompok`,
      });
    }

    const nowIso = new Date().toISOString();
    const existingMeta = db.artworksMeta[groupId] ?? {};
    let photoUrl = existingMeta.photoUrl ?? null;
    let photoUpdatedAt = existingMeta.photoUpdatedAt ?? null;
    let savedOriginalName = existingMeta.originalFileName ?? null;
    let savedOriginalSize = existingMeta.originalFileSize ?? null;
    let savedOriginalMime = existingMeta.originalMimeType ?? null;
    let nextDriveFileId = existingMeta.driveFileId ?? null;
    let nextDriveWebViewLink = existingMeta.driveWebViewLink ?? null;
    let nextDriveSyncedAt = existingMeta.driveSyncedAt ?? null;

    let groupPhotoUrl = existingMeta.groupPhotoUrl ?? null;
    let groupPhotoUpdatedAt = existingMeta.groupPhotoUpdatedAt ?? null;
    let savedGroupOriginalName = existingMeta.groupOriginalFileName ?? null;
    let savedGroupOriginalSize = existingMeta.groupOriginalFileSize ?? null;
    let savedGroupOriginalMime = existingMeta.groupOriginalMimeType ?? null;
    let nextGroupDriveFileId = existingMeta.groupDriveFileId ?? null;
    let nextGroupDriveWebViewLink = existingMeta.groupDriveWebViewLink ?? null;
    let nextGroupDriveSyncedAt = existingMeta.groupDriveSyncedAt ?? null;

    const hasMetadataEdit =
      memberNames !== undefined ||
      artworkTitle !== undefined ||
      technique !== undefined ||
      leaves !== undefined ||
      fabric !== undefined ||
      mordant !== undefined ||
      description !== undefined;

    const mergedMetaDraft = {
      ...existingMeta,
      ...(memberNames !== undefined ? { memberNames: memberNames.slice(0, 160) } : {}),
      ...(artworkTitle !== undefined ? { artworkTitle: artworkTitle.slice(0, 80) } : {}),
      ...(technique !== undefined ? { technique: technique.slice(0, 50) } : {}),
      ...(leaves !== undefined ? { leaves: leaves.slice(0, 120) } : {}),
      ...(fabric !== undefined ? { fabric: fabric.slice(0, 60) } : {}),
      ...(mordant !== undefined ? { mordant: mordant.slice(0, 60) } : {}),
      ...(description !== undefined ? { description: description.slice(0, 260) } : {}),
      ...(hasMetadataEdit ? { metadataUpdatedAt: nowIso } : {}),
    };
    const groupSnapshot =
      getGroupById(
        groupId,
        buildCatalogWithOverrides({ ...db.artworksMeta, [groupId]: mergedMetaDraft }),
      ) ?? getGroupById(groupId)!;

    let driveSyncStatus: 'synced' | 'pending' | 'error' | 'none' =
      decodedArtwork || decodedGroup ? 'pending' : 'none';
    let driveSyncMessage: string | null = null;

    // 1) WRITE TO TEACHER'S GOOGLE DRIVE FIRST (when Drive bridge/session or webhook is available)
    if (decodedArtwork || decodedGroup) {
      const activeDriveSession = await getActiveDriveSession();
      const driveTokenToUse = headerDriveToken ?? activeDriveSession?.accessToken ?? null;

      let wroteViaOAuth = false;

      if (driveTokenToUse) {
        try {
          const driveRes = await syncSingleGroupToDrive({
            accessToken: driveTokenToUse,
            ownerEmail: activeDriveSession?.ownerEmail ?? db.driveConfig.driveOwnerEmail,
            driveConfig: db.driveConfig,
            group: groupSnapshot,
            artworkFile: decodedArtwork
              ? {
                  buffer: decodedArtwork.buffer,
                  originalFileName: decodedArtwork.fileName,
                  mimeType: decodedArtwork.mimeType,
                }
              : null,
            groupFile: decodedGroup
              ? {
                  buffer: decodedGroup.buffer,
                  originalFileName: decodedGroup.fileName,
                  mimeType: decodedGroup.mimeType,
                }
              : null,
          });
          db.driveConfig = driveRes.driveConfig;
          if (driveRes.artworkResult) {
            nextDriveFileId = driveRes.artworkResult.driveFileId;
            nextDriveWebViewLink = driveRes.artworkResult.driveWebViewLink;
            nextDriveSyncedAt = driveRes.artworkResult.driveSyncedAt;
          }
          if (driveRes.groupResult) {
            nextGroupDriveFileId = driveRes.groupResult.driveFileId;
            nextGroupDriveWebViewLink = driveRes.groupResult.driveWebViewLink;
            nextGroupDriveSyncedAt = driveRes.groupResult.driveSyncedAt;
          }
          wroteViaOAuth = true;
          driveSyncStatus = 'synced';
          driveSyncMessage = `Foto asli berhasil ditulis langsung ke Google Drive folder "galery penilaian Ecoprint / Kelas ${groupSnapshot.className}".`;
        } catch (err) {
          if (err instanceof ServerDriveApiError && err.status === 401) {
            await clearActiveDriveSession();
          }
          driveSyncStatus = 'error';
          driveSyncMessage =
            err instanceof Error
              ? err.message
              : 'Gagal menulis langsung ke Google Drive saat ini; foto aman tersimpan untuk disinkronkan.';
        }
      }

      // 2) Fallback / 24-hour Apps Script bridge if configured
      const webhookUrl = db.driveConfig.driveWebhookUrl;
      if (!wroteViaOAuth && webhookUrl) {
        try {
          if (decodedArtwork) {
            const up = await uploadViaAppsScriptWebhook(webhookUrl, {
              group: groupSnapshot,
              kind: 'artwork',
              buffer: decodedArtwork.buffer,
              originalFileName: decodedArtwork.fileName,
              mimeType: decodedArtwork.mimeType,
            });
            nextDriveFileId = up.driveFileId;
            nextDriveWebViewLink = up.driveWebViewLink;
            nextDriveSyncedAt = up.driveSyncedAt;
            if (up.driveFolderId && up.driveFolderUrl) {
              db.driveConfig = {
                ...db.driveConfig,
                driveFolderId: up.driveFolderId,
                driveFolderUrl: up.driveFolderUrl,
                driveOwnerEmail: up.driveOwnerEmail ?? db.driveConfig.driveOwnerEmail,
                lastSyncedAt: up.driveSyncedAt,
              };
            }
          }
          if (decodedGroup) {
            const up = await uploadViaAppsScriptWebhook(webhookUrl, {
              group: groupSnapshot,
              kind: 'group',
              buffer: decodedGroup.buffer,
              originalFileName: decodedGroup.fileName,
              mimeType: decodedGroup.mimeType,
            });
            nextGroupDriveFileId = up.driveFileId;
            nextGroupDriveWebViewLink = up.driveWebViewLink;
            nextGroupDriveSyncedAt = up.driveSyncedAt;
            if (up.driveFolderId && up.driveFolderUrl) {
              db.driveConfig = {
                ...db.driveConfig,
                driveFolderId: up.driveFolderId,
                driveFolderUrl: up.driveFolderUrl,
                driveOwnerEmail: up.driveOwnerEmail ?? db.driveConfig.driveOwnerEmail,
                lastSyncedAt: up.driveSyncedAt,
              };
            }
          }
          driveSyncStatus = 'synced';
          driveSyncMessage = `Foto asli berhasil dikirim langsung ke Google Drive (Kelas ${groupSnapshot.className}) via Apps Script Bridge.`;
        } catch (err) {
          driveSyncStatus = 'error';
          driveSyncMessage =
            err instanceof Error
              ? err.message
              : 'Bridge Apps Script gagal; foto disimpan aman di server.';
        }
      }
    }

    // 3) Always persist original bytes cleanly on server/Redis for fast fallback & original download
    const ts = Date.now();
    if (decodedArtwork) {
      await saveUploadedFile(
        groupId,
        decodedArtwork.ext,
        decodedArtwork.mimeType,
        decodedArtwork.buffer,
        'artwork',
      );
      const storedDiskName = `${groupId}.${decodedArtwork.ext}`;
      photoUrl = `/uploads/${storedDiskName}?v=${ts}`;
      photoUpdatedAt = nowIso;
      savedOriginalName = decodedArtwork.fileName;
      savedOriginalSize = decodedArtwork.buffer.byteLength;
      savedOriginalMime = decodedArtwork.mimeType;

      if (driveSyncStatus !== 'synced') {
        nextDriveFileId = driveFileId ?? null;
        nextDriveWebViewLink = driveWebViewLink ?? null;
        nextDriveSyncedAt = driveSyncedAt ?? null;
      }
    }

    if (decodedGroup) {
      await saveUploadedFile(
        groupId,
        decodedGroup.ext,
        decodedGroup.mimeType,
        decodedGroup.buffer,
        'group',
      );
      const storedGroupDiskName = `${groupId}_kelompok.${decodedGroup.ext}`;
      groupPhotoUrl = `/uploads/${storedGroupDiskName}?v=${ts}`;
      groupPhotoUpdatedAt = nowIso;
      savedGroupOriginalName = decodedGroup.fileName;
      savedGroupOriginalSize = decodedGroup.buffer.byteLength;
      savedGroupOriginalMime = decodedGroup.mimeType;

      if (driveSyncStatus !== 'synced') {
        nextGroupDriveFileId = null;
        nextGroupDriveWebViewLink = null;
        nextGroupDriveSyncedAt = null;
      }
    }

    if (driveFolderId && driveFolderUrl) {
      db.driveConfig = {
        ...db.driveConfig,
        driveFolderId,
        driveFolderUrl,
        ...(driveOpenAccessStatus !== undefined ? { driveOpenAccessStatus } : {}),
        lastSyncedAt: nowIso,
      };
    }

    db.artworksMeta[groupId] = {
      ...mergedMetaDraft,
      photoUrl,
      photoUpdatedAt,
      originalFileName: savedOriginalName,
      originalFileSize: savedOriginalSize,
      originalMimeType: savedOriginalMime,
      driveFileId: nextDriveFileId,
      driveWebViewLink: nextDriveWebViewLink,
      driveSyncedAt: nextDriveSyncedAt,
      groupPhotoUrl,
      groupPhotoUpdatedAt,
      groupOriginalFileName: savedGroupOriginalName,
      groupOriginalFileSize: savedGroupOriginalSize,
      groupOriginalMimeType: savedGroupOriginalMime,
      groupDriveFileId: nextGroupDriveFileId,
      groupDriveWebViewLink: nextGroupDriveWebViewLink,
      groupDriveSyncedAt: nextGroupDriveSyncedAt,
    };

    // 4) Auto-write complete manifest & CSV snapshot to Google Drive when connected
    const manifestSynced = await autoSyncManifestToDrive(db, headerDriveToken);
    if (!decodedArtwork && !decodedGroup && manifestSynced) {
      driveSyncStatus = 'synced';
      driveSyncMessage = 'Perubahan data kelompok otomatis disinkronkan ke Google Drive.';
    }

    await saveDatabase(db);
    return {
      state: await buildApiState(db),
      driveSyncStatus,
      driveSyncMessage,
    };
  }

  async function processGroupPhotoDelete(params: {
    db: PersistedDatabase;
    groupId: string;
    targetKind: PhotoKind | 'all';
    headerDriveToken: string | null;
  }) {
    const { db, groupId, targetKind, headerDriveToken } = params;
    const existingMeta = db.artworksMeta[groupId] ?? {};
    const sessionDrive = await getActiveDriveSession();
    const driveToken = headerDriveToken ?? sessionDrive?.accessToken ?? null;

    if (driveToken) {
      if ((targetKind === 'all' || targetKind === 'artwork') && existingMeta.driveFileId) {
        await deleteDriveFile(driveToken, existingMeta.driveFileId).catch(() => {});
      }
      if ((targetKind === 'all' || targetKind === 'group') && existingMeta.groupDriveFileId) {
        await deleteDriveFile(driveToken, existingMeta.groupDriveFileId).catch(() => {});
      }
    }

    await deleteUploadedFile(groupId, targetKind);

    const nextMeta = { ...existingMeta, metadataUpdatedAt: new Date().toISOString() };
    if (targetKind === 'all' || targetKind === 'artwork') {
      nextMeta.photoUrl = null;
      nextMeta.photoUpdatedAt = null;
      nextMeta.originalFileName = null;
      nextMeta.originalFileSize = null;
      nextMeta.originalMimeType = null;
      nextMeta.driveFileId = null;
      nextMeta.driveWebViewLink = null;
      nextMeta.driveSyncedAt = null;
    }
    if (targetKind === 'all' || targetKind === 'group') {
      nextMeta.groupPhotoUrl = null;
      nextMeta.groupPhotoUpdatedAt = null;
      nextMeta.groupOriginalFileName = null;
      nextMeta.groupOriginalFileSize = null;
      nextMeta.groupOriginalMimeType = null;
      nextMeta.groupDriveFileId = null;
      nextMeta.groupDriveWebViewLink = null;
      nextMeta.groupDriveSyncedAt = null;
    }

    db.artworksMeta[groupId] = nextMeta;
    await autoSyncManifestToDrive(db, headerDriveToken);
    await saveDatabase(db);

    return { state: await buildApiState(db) };
  }

  // Upload original-size artwork photo + group-with-artwork photo and/or edit metadata for the authenticated group.
  // Writes FIRST to teacher's Google Drive when connected (active Drive session or Apps Script bridge), then saves local/Redis copy.
  app.post('/api/artworks/:groupId/photo', async (req, res) => {
    const { groupId } = req.params;
    if (!getGroupById(groupId)) {
      res.status(404).json({ error: 'Kelompok tidak ditemukan.' });
      return;
    }

    const db = await loadDatabase();
    const verifiedGroupId = verifyGroupToken(extractToken(req), db);

    if (!verifiedGroupId || verifiedGroupId !== groupId) {
      res.status(401).json({
        error: `Anda harus masuk menggunakan password Kelompok ${groupId} untuk mengedit karya atau mengupload foto ini.`,
      });
      return;
    }

    const headerDriveToken =
      typeof req.headers['x-drive-token'] === 'string' &&
      req.headers['x-drive-token'].trim()
        ? req.headers['x-drive-token'].trim()
        : null;

    try {
      const result = await processGroupArtworkSave({
        db,
        groupId,
        body: req.body as ArtworkSaveBody,
        headerDriveToken,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal memproses file foto.',
      });
    }
  });

  app.delete('/api/artworks/:groupId/photo', async (req, res) => {
    const { groupId } = req.params;
    if (!getGroupById(groupId)) {
      res.status(404).json({ error: 'Kelompok tidak ditemukan.' });
      return;
    }

    const rawKind = typeof req.query.kind === 'string' ? req.query.kind : 'all';
    const targetKind: PhotoKind | 'all' =
      rawKind === 'artwork' || rawKind === 'group' ? rawKind : 'all';

    const db = await loadDatabase();
    const verifiedGroupId = verifyGroupToken(extractToken(req), db);

    if (!verifiedGroupId || verifiedGroupId !== groupId) {
      res.status(401).json({
        error: `Anda harus masuk menggunakan password Kelompok ${groupId} untuk menghapus foto ini.`,
      });
      return;
    }

    const driveHeader = req.headers['x-drive-token'];
    const headerDriveToken =
      typeof driveHeader === 'string' && driveHeader.trim() ? driveHeader.trim() : null;

    const result = await processGroupPhotoDelete({
      db,
      groupId,
      targetKind,
      headerDriveToken,
    });
    res.json(result);
  });

  // Admin endpoints to edit ANY group's name, title, leaves, description, and both original photos
  app.post('/api/admin/artworks/:groupId', async (req, res) => {
    const { groupId } = req.params;
    if (!getGroupById(groupId)) {
      res.status(404).json({ error: 'Kelompok tidak ditemukan.' });
      return;
    }

    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login sebagai Admin Guru.' });
      return;
    }

    const headerDriveToken =
      typeof req.headers['x-drive-token'] === 'string' &&
      req.headers['x-drive-token'].trim()
        ? req.headers['x-drive-token'].trim()
        : null;

    try {
      const result = await processGroupArtworkSave({
        db,
        groupId,
        body: req.body as ArtworkSaveBody,
        headerDriveToken,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan karya oleh Admin.',
      });
    }
  });

  app.delete('/api/admin/artworks/:groupId/photo', async (req, res) => {
    const { groupId } = req.params;
    if (!getGroupById(groupId)) {
      res.status(404).json({ error: 'Kelompok tidak ditemukan.' });
      return;
    }

    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login sebagai Admin Guru.' });
      return;
    }

    const rawKind = typeof req.query.kind === 'string' ? req.query.kind : 'all';
    const targetKind: PhotoKind | 'all' =
      rawKind === 'artwork' || rawKind === 'group' ? rawKind : 'all';

    const driveHeader = req.headers['x-drive-token'];
    const headerDriveToken =
      typeof driveHeader === 'string' && driveHeader.trim() ? driveHeader.trim() : null;

    const result = await processGroupPhotoDelete({
      db,
      groupId,
      targetKind,
      headerDriveToken,
    });
    res.json(result);
  });

  // Serve uploaded artwork & group photos seamlessly across disk/tmp and Upstash Redis
  app.get('/uploads/:filename', async (req, res) => {
    const { filename } = req.params;
    const dotIdx = filename.lastIndexOf('.');
    const baseName = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
    const isGroupPhoto = baseName.endsWith('_kelompok');
    const groupId = isGroupPhoto ? baseName.slice(0, -'_kelompok'.length) : baseName;
    const kind: PhotoKind = isGroupPhoto ? 'group' : 'artwork';

    if (!getGroupById(groupId)) {
      res.status(404).end();
      return;
    }

    const fileData = await readUploadedFile(groupId, kind);
    if (!fileData) {
      res.status(404).end();
      return;
    }

    const db = await loadDatabase();
    const meta = db.artworksMeta[groupId];
    const mime = isGroupPhoto
      ? meta?.groupOriginalMimeType || fileData.mimeType
      : meta?.originalMimeType || fileData.mimeType;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(fileData.buffer);
  });

  // Download exact original uploaded file (with Content-Disposition attachment)
  app.get('/api/artworks/:groupId/download-original', async (req, res) => {
    const { groupId } = req.params;
    const kind: PhotoKind = req.query.kind === 'group' ? 'group' : 'artwork';
    const fileData = await readUploadedFile(groupId, kind);
    if (!fileData) {
      res.status(404).json({ error: 'File asli belum tersedia di server.' });
      return;
    }
    const db = await loadDatabase();
    const meta = db.artworksMeta[groupId];
    const downloadName =
      kind === 'group'
        ? meta?.groupOriginalFileName || `${groupId}_kelompok.${fileData.ext}`
        : meta?.originalFileName || `${groupId}.${fileData.ext}`;
    const mime =
      kind === 'group'
        ? meta?.groupOriginalMimeType || fileData.mimeType
        : meta?.originalMimeType || fileData.mimeType;
    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadName.replace(/"/g, '')}"`,
    );
    res.send(fileData.buffer);
  });

  // Stream original uploaded file bytes for Admin Google Drive auto-sync
  app.get('/api/admin/original-file/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const kind: PhotoKind = req.query.kind === 'group' ? 'group' : 'artwork';
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak.' });
      return;
    }

    const fileData = await readUploadedFile(groupId, kind);
    if (!fileData) {
      res.status(404).json({ error: 'File asli belum tersedia di server.' });
      return;
    }

    const meta = db.artworksMeta[groupId];
    const mime =
      kind === 'group'
        ? meta?.groupOriginalMimeType || fileData.mimeType
        : meta?.originalMimeType || fileData.mimeType;
    const origName =
      kind === 'group' ? meta?.groupOriginalFileName : meta?.originalFileName;
    res.setHeader('Content-Type', mime);
    if (origName) {
      res.setHeader('X-Original-Filename', encodeURIComponent(origName));
    }
    res.send(fileData.buffer);
  });

  // Register active teacher Drive OAuth session on server so students can write directly to Drive upon upload
  app.post('/api/admin/drive-session', async (req, res) => {
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
    const { ownerEmail } = req.body as { ownerEmail?: string | null };
    await setActiveDriveSession(driveAccessToken, ownerEmail ?? db.driveConfig.driveOwnerEmail);
    res.json({ ok: true, state: await buildApiState(db) });
  });

  app.post('/api/admin/drive-disconnect', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak.' });
      return;
    }
    await clearActiveDriveSession();
    res.json({ ok: true, state: await buildApiState(db) });
  });

  app.post('/api/admin/drive-webhook', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak.' });
      return;
    }
    const { driveWebhookUrl } = req.body as { driveWebhookUrl?: string | null };
    const trimmed = typeof driveWebhookUrl === 'string' ? driveWebhookUrl.trim() : '';
    if (trimmed && !/^https:\/\/(script\.google\.com|script\.googleusercontent\.com)\//i.test(trimmed)) {
      res.status(400).json({
        error: 'URL Bridge harus berasal dari Web App Google Apps Script (https://script.google.com/...).',
      });
      return;
    }
    db.driveConfig = {
      ...db.driveConfig,
      driveWebhookUrl: trimmed || null,
    };
    await saveDatabase(db);
    res.json({ ok: true, state: await buildApiState(db) });
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
      await setActiveDriveSession(driveAccessToken, ownerEmail ?? db.driveConfig.driveOwnerEmail);

      const syncResult = await runFullDriveSync({
        accessToken: driveAccessToken,
        ownerEmail,
        driveConfig: db.driveConfig,
        artworksMeta: db.artworksMeta,
        submissions: db.submissions,
        readUploadedFileBuffer: async (gid, kind) => {
          const data = await readUploadedFile(gid, kind);
          return data ? { buffer: data.buffer, mimeType: data.mimeType } : null;
        },
        applyOpenAccess,
        forceArchiveDocs,
        pullFromDrive: true,
      });

      db.driveConfig = syncResult.driveConfig;
      db.artworksMeta = syncResult.mergedArtworksMeta;
      db.submissions = syncResult.mergedSubmissions;
      await saveDatabase(db);

      res.json({
        state: await buildApiState(db),
        syncedCount: syncResult.syncedItems.length,
        pulledGroupsCount: syncResult.pulledGroupsCount,
        pulledVotesCount: syncResult.pulledVotesCount,
        driveFiles: syncResult.driveFiles,
        openAccessMessage: syncResult.openAccessMessage ?? null,
      });
    } catch (err) {
      if (err instanceof ServerDriveApiError && err.status === 401) {
        await clearActiveDriveSession();
      }
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

  app.post('/api/admin/drive-pull', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login Admin Guru.' });
      return;
    }

    const driveTokenHeader = req.headers['x-drive-token'];
    const headerToken =
      typeof driveTokenHeader === 'string' ? driveTokenHeader.trim() : '';
    const activeSession = await getActiveDriveSession();
    const driveAccessToken = headerToken || activeSession?.accessToken || '';

    if (!driveAccessToken) {
      res.status(400).json({
        error: 'Token Google Drive tidak tersedia. Silakan Sign in with Google.',
      });
      return;
    }

    try {
      const syncResult = await runFullDriveSync({
        accessToken: driveAccessToken,
        ownerEmail: activeSession?.ownerEmail ?? db.driveConfig.driveOwnerEmail,
        driveConfig: db.driveConfig,
        artworksMeta: db.artworksMeta,
        submissions: db.submissions,
        readUploadedFileBuffer: async (gid, kind) => {
          const data = await readUploadedFile(gid, kind);
          return data ? { buffer: data.buffer, mimeType: data.mimeType } : null;
        },
        applyOpenAccess: false,
        forceArchiveDocs: false,
        pullFromDrive: true,
      });

      db.driveConfig = syncResult.driveConfig;
      db.artworksMeta = syncResult.mergedArtworksMeta;
      db.submissions = syncResult.mergedSubmissions;
      await saveDatabase(db);

      res.json({
        state: await buildApiState(db),
        pulledGroupsCount: syncResult.pulledGroupsCount,
        pulledVotesCount: syncResult.pulledVotesCount,
        syncedCount: syncResult.syncedItems.length,
        driveFiles: syncResult.driveFiles,
      });
    } catch (err) {
      if (err instanceof ServerDriveApiError && err.status === 401) {
        await clearActiveDriveSession();
      }
      if (err instanceof ServerDriveApiError) {
        res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
          error: err.message,
          reason: err.reason ?? null,
          activationUrl: err.activationUrl ?? null,
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menarik data dari Google Drive.',
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
      await setActiveDriveSession(driveAccessToken, ownerEmail ?? db.driveConfig.driveOwnerEmail);
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
        state: await buildApiState(db),
        status: accessRes.status,
        message: accessRes.message ?? null,
      });
    } catch (err) {
      if (err instanceof ServerDriveApiError && err.status === 401) {
        await clearActiveDriveSession();
      }
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
    res.json(await buildApiState(db));
  });

  app.post('/api/admin/drive-sync-record', async (req, res) => {
    const db = await loadDatabase();
    const token = extractToken(req);
    const isAdmin = verifyAdminToken(token, db);
    const groupIdFromToken = verifyGroupToken(token, db);

    const { groupId, kind = 'artwork', driveFileId, driveWebViewLink, manifestFileId } = req.body as {
      groupId?: string;
      kind?: PhotoKind;
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
    const nowIso = new Date().toISOString();
    db.artworksMeta[groupId] = {
      ...existingMeta,
      ...(kind === 'group'
        ? {
            groupDriveFileId: driveFileId,
            groupDriveWebViewLink: driveWebViewLink,
            groupDriveSyncedAt: nowIso,
          }
        : {
            driveFileId,
            driveWebViewLink,
            driveSyncedAt: nowIso,
          }),
    };
    if (manifestFileId !== undefined) {
      db.driveConfig.manifestFileId = manifestFileId;
    }
    db.driveConfig.lastSyncedAt = nowIso;
    await saveDatabase(db);

    res.json(await buildApiState(db));
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
    await autoSyncManifestToDrive(db);
    await saveDatabase(db);

    res.status(201).json({
      submission: lockedSubmission,
      state: await buildApiState(db),
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
    await autoSyncManifestToDrive(db);
    await saveDatabase(db);
    res.json(await buildApiState(db));
  });

  app.post('/api/admin/reset', async (req, res) => {
    const db = await loadDatabase();
    if (!verifyAdminToken(extractToken(req), db)) {
      res.status(401).json({ error: 'Akses ditolak. Silakan login sebagai Admin Guru.' });
      return;
    }
    db.submissions = [];
    await autoSyncManifestToDrive(db);
    await saveDatabase(db);
    res.json(await buildApiState(db));
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
    await autoSyncManifestToDrive(db);
    await saveDatabase(db);
    res.json(await buildApiState(db));
  });

  return app;
}
