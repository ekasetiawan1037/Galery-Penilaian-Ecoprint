import fs from 'fs';
import {
  type ArtworkGroup,
  type DriveArchiveConfig,
  type DriveOpenAccessStatus,
  type RecapitulationSummary,
} from '../src/shared/ecoprint.ts';

const TARGET_FOLDER_NAME = 'galery penilaian Ecoprint';
const MANIFEST_FILE_NAME = 'ecoprint-arsip-manifest.json';
const CSV_ARCHIVE_FILE_NAME = 'Rekap_Karya_Ecoprint.csv';

function getDriveApiBase(): string {
  return (process.env.DRIVE_API_BASE || 'https://www.googleapis.com').replace(/\/$/, '');
}

export class ServerDriveApiError extends Error {
  status: number;
  reason?: string;
  activationUrl?: string;

  constructor(
    message: string,
    status: number,
    reason?: string,
    activationUrl?: string,
  ) {
    super(message);
    this.name = 'ServerDriveApiError';
    this.status = status;
    this.reason = reason;
    this.activationUrl = activationUrl;
  }
}

export interface DriveFileSummary {
  id: string;
  name: string;
  className?: string;
  webViewLink: string;
  webContentLink?: string;
  size?: string;
  mimeType?: string;
  createdTime?: string;
}

function parseDriveError(status: number, rawText: string, prefix: string): ServerDriveApiError {
  try {
    const parsed = JSON.parse(rawText) as {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string; message?: string }>;
        details?: Array<{
          reason?: string;
          metadata?: { activationUrl?: string };
        }>;
      };
    };

    const reason =
      parsed.error?.details?.find((d) => d.reason)?.reason ??
      parsed.error?.errors?.[0]?.reason;
    const activationUrl =
      parsed.error?.details?.find((d) => d.metadata?.activationUrl)?.metadata?.activationUrl;

    if (reason === 'SERVICE_DISABLED' || reason === 'accessNotConfigured') {
      return new ServerDriveApiError(
        'Google Drive API belum diaktifkan pada project Google Cloud aplikasi ini. Klik tombol "1. Aktifkan Google Drive API", aktifkan layanan, tunggu ~1 menit, lalu klik Coba Hubungkan Lagi.',
        status,
        'SERVICE_DISABLED',
        activationUrl,
      );
    }

    if (status === 401) {
      return new ServerDriveApiError(
        'Sesi akses Google Drive telah berakhir. Silakan klik "Sign in with Google" kembali.',
        401,
        'UNAUTHENTICATED',
      );
    }

    if (status === 403) {
      return new ServerDriveApiError(
        `Akses Google Drive ditolak (403): ${parsed.error?.message || 'Pastikan akun eka.setiawan1037@guru.smp.belajar.id memberi izin Google Drive.'}`,
        403,
        reason,
      );
    }

    return new ServerDriveApiError(
      `${prefix} (${status}): ${parsed.error?.message || rawText}`,
      status,
      reason,
      activationUrl,
    );
  } catch {
    if (status === 401) {
      return new ServerDriveApiError(
        'Sesi akses Google Drive telah berakhir. Silakan Sign in with Google kembali.',
        401,
        'UNAUTHENTICATED',
      );
    }
    return new ServerDriveApiError(`${prefix} (${status}): ${rawText}`, status);
  }
}

async function inspectFolderOpenAccess(
  accessToken: string,
  folderId: string,
): Promise<DriveOpenAccessStatus> {
  try {
    const res = await fetch(
      `${getDriveApiBase()}/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=permissions(id,type,role)`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as {
      permissions?: Array<{ id: string; type: string; role: string }>;
    };
    const anyonePerm = data.permissions?.find((p) => p.type === 'anyone');
    if (!anyonePerm) return 'restricted';
    if (anyonePerm.role === 'writer' || anyonePerm.role === 'organizer') {
      return 'anyone-writer';
    }
    return 'anyone-reader';
  } catch {
    return 'unknown';
  }
}

export async function ensureFolderOpenAccess(
  accessToken: string,
  folderId: string,
): Promise<{ status: DriveOpenAccessStatus; message?: string }> {
  const current = await inspectFolderOpenAccess(accessToken, folderId);
  if (current === 'anyone-writer') {
    return { status: 'anyone-writer' };
  }

  const writerRes = await fetch(
    `${getDriveApiBase()}/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=id,type,role`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'anyone', role: 'writer' }),
    },
  );
  if (writerRes.ok) {
    return { status: 'anyone-writer' };
  }

  const readerRes = await fetch(
    `${getDriveApiBase()}/drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=id,type,role`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    },
  );
  if (readerRes.ok) {
    return {
      status: 'anyone-reader',
      message:
        'Kebijakan domain Workspace membatasi akses tulis publik; folder disetel ke Anyone Can View.',
    };
  }

  return {
    status: 'restricted',
    message:
      'Kebijakan domain Google membatasi tautan publik; file tetap tersimpan aman di folder Google Drive Anda.',
  };
}

async function trySetFilePublicRead(
  accessToken: string,
  fileId: string,
): Promise<void> {
  try {
    await fetch(
      `${getDriveApiBase()}/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=id`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'anyone', role: 'reader' }),
      },
    );
  } catch {
    // Non-fatal
  }
}

export async function ensureRootFolder(
  accessToken: string,
  existingFolderId?: string | null,
  applyOpenAccess = true,
): Promise<{
  id: string;
  webViewLink: string;
  openAccessStatus: DriveOpenAccessStatus;
  openAccessMessage?: string;
}> {
  const base = getDriveApiBase();

  if (existingFolderId) {
    const checkRes = await fetch(
      `${base}/drive/v3/files/${encodeURIComponent(existingFolderId)}?fields=id,name,webViewLink,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (checkRes.ok) {
      const existing = (await checkRes.json()) as {
        id: string;
        name?: string;
        webViewLink?: string;
        trashed?: boolean;
      };
      if (existing.id && !existing.trashed && existing.name === TARGET_FOLDER_NAME) {
        const access = applyOpenAccess
          ? await ensureFolderOpenAccess(accessToken, existing.id)
          : { status: await inspectFolderOpenAccess(accessToken, existing.id) };
        return {
          id: existing.id,
          webViewLink:
            existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`,
          openAccessStatus: access.status,
          openAccessMessage: access.message,
        };
      }
    } else if (checkRes.status === 401 || checkRes.status === 403) {
      throw parseDriveError(checkRes.status, await checkRes.text(), 'Gagal memeriksa folder Drive');
    }
  }

  const escapedName = TARGET_FOLDER_NAME.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const searchRes = await fetch(
    `${base}/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!searchRes.ok) {
    throw parseDriveError(searchRes.status, await searchRes.text(), 'Gagal mencari folder Drive');
  }
  const searchData = (await searchRes.json()) as {
    files?: Array<{ id: string; name?: string; webViewLink?: string }>;
  };
  const found = searchData.files?.[0];
  if (found) {
    const access = applyOpenAccess
      ? await ensureFolderOpenAccess(accessToken, found.id)
      : { status: await inspectFolderOpenAccess(accessToken, found.id) };
    return {
      id: found.id,
      webViewLink: found.webViewLink || `https://drive.google.com/drive/folders/${found.id}`,
      openAccessStatus: access.status,
      openAccessMessage: access.message,
    };
  }

  const createRes = await fetch(
    `${base}/drive/v3/files?fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: TARGET_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        description:
          'Arsip karya & foto Ecoprint ukuran asli per kelas (71–95) tanpa kompresi.',
      }),
    },
  );

  if (!createRes.ok) {
    throw parseDriveError(
      createRes.status,
      await createRes.text(),
      `Gagal membuat folder "${TARGET_FOLDER_NAME}"`,
    );
  }

  const created = (await createRes.json()) as { id: string; webViewLink?: string };
  const access = applyOpenAccess
    ? await ensureFolderOpenAccess(accessToken, created.id)
    : { status: 'restricted' as DriveOpenAccessStatus };

  return {
    id: created.id,
    webViewLink: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
    openAccessStatus: access.status,
    openAccessMessage: access.message,
  };
}

export async function ensureClassSubfolder(
  accessToken: string,
  rootFolderId: string,
  className: string,
  existingId?: string | null,
  applyOpenAccess = true,
): Promise<string> {
  const base = getDriveApiBase();
  const folderName = `Kelas ${className}`;

  if (existingId) {
    const checkRes = await fetch(
      `${base}/drive/v3/files/${encodeURIComponent(existingId)}?fields=id,name,parents,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (checkRes.ok) {
      const existing = (await checkRes.json()) as {
        id: string;
        name?: string;
        parents?: string[];
        trashed?: boolean;
      };
      if (
        existing.id &&
        !existing.trashed &&
        existing.name === folderName &&
        (!existing.parents || existing.parents.includes(rootFolderId))
      ) {
        return existing.id;
      }
    }
  }

  const q = encodeURIComponent(
    `'${rootFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const searchRes = await fetch(
    `${base}/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (searchRes.ok) {
    const searchData = (await searchRes.json()) as {
      files?: Array<{ id: string }>;
    };
    if (searchData.files?.[0]?.id) {
      return searchData.files[0].id;
    }
  }

  const createRes = await fetch(
    `${base}/drive/v3/files?fields=id,name`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        parents: [rootFolderId],
        mimeType: 'application/vnd.google-apps.folder',
        description: `Arsip foto karya Ecoprint ukuran asli ${folderName}.`,
      }),
    },
  );
  if (!createRes.ok) {
    throw parseDriveError(
      createRes.status,
      await createRes.text(),
      `Gagal membuat subfolder ${folderName}`,
    );
  }
  const created = (await createRes.json()) as { id: string };
  if (applyOpenAccess) {
    await ensureFolderOpenAccess(accessToken, created.id).catch(() => {});
  }
  return created.id;
}

export async function uploadBinaryFileToDrive(
  accessToken: string,
  targetFolderId: string,
  group: ArtworkGroup,
  filePath: string,
  originalFileName: string,
  mimeType: string,
): Promise<DriveFileSummary> {
  const base = getDriveApiBase();
  const fileBuffer = fs.readFileSync(filePath);
  const safeTitle = group.artworkTitle.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Karya';
  const driveName = `${group.groupId}_Kls${group.className}_${safeTitle}_${originalFileName}`;
  const memberInfo = group.memberNames ? ` | Anggota: ${group.memberNames}` : '';

  const metadata = {
    name: driveName,
    parents: [targetFolderId],
    mimeType,
    description: `Kelompok: ${group.groupId} | Kelas: ${group.className}${memberInfo} | Judul: ${group.artworkTitle} | Daun: ${group.leaves} | Teknik: ${group.technique}`,
  };

  const initRes = await fetch(
    `${base}/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,webContentLink,size,mimeType,createdTime`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileBuffer.byteLength),
      },
      body: JSON.stringify(metadata),
    },
  );

  if (!initRes.ok) {
    throw parseDriveError(
      initRes.status,
      await initRes.text(),
      `Gagal memulai upload file ${group.groupId} ke Google Drive`,
    );
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('Google Drive tidak mengembalikan URL sesi resumable upload.');
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(fileBuffer.byteLength),
    },
    body: fileBuffer,
  });

  if (!putRes.ok) {
    throw parseDriveError(
      putRes.status,
      await putRes.text(),
      `Gagal menulis file asli ${group.groupId} ke Google Drive`,
    );
  }

  const uploaded = (await putRes.json()) as DriveFileSummary;
  await trySetFilePublicRead(accessToken, uploaded.id);

  return {
    ...uploaded,
    className: group.className,
    webViewLink:
      uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
  };
}

function buildCsvContent(
  catalog: ArtworkGroup[],
  recapitulation: RecapitulationSummary,
): string {
  const scoreMap = new Map<string, { totalPoints: number; gradeRank: number; votesCount: number }>();
  ([7, 8, 9] as const).forEach((g) => {
    recapitulation.byGrade[g].rows.forEach((row) => {
      scoreMap.set(row.artwork.groupId, {
        totalPoints: row.totalPoints,
        gradeRank: row.gradeRank,
        votesCount: row.votesCount,
      });
    });
  });

  const escapeCsv = (val: string | number | null | undefined): string => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = [
    'Kelompok',
    'Kelas',
    'Jenjang',
    'Nama Kelompok / Anggota',
    'Judul Karya',
    'Daun yang Digunakan',
    'Teknik',
    'Media Kain',
    'Mordant',
    'Nama File Asli',
    'Ukuran File (Byte)',
    'Total Poin',
    'Jumlah Penilai',
    'Peringkat Jenjang',
    'Link Google Drive',
  ].join(',');

  const lines = catalog.map((art) => {
    const score = scoreMap.get(art.groupId);
    return [
      art.groupId,
      art.className,
      art.grade,
      art.memberNames,
      art.artworkTitle,
      art.leaves,
      art.technique,
      art.fabric,
      art.mordant,
      art.originalFileName ?? '',
      art.originalFileSize ?? '',
      score?.totalPoints ?? 0,
      score?.votesCount ?? 0,
      score?.gradeRank ?? '',
      art.driveWebViewLink ?? '',
    ]
      .map(escapeCsv)
      .join(',');
  });

  return '\uFEFF' + [header, ...lines].join('\r\n');
}

async function upsertTextFileToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  content: string,
  existingFileId?: string | null,
): Promise<string> {
  const base = getDriveApiBase();
  const buf = Buffer.from(content, 'utf-8');

  if (existingFileId) {
    const patchRes = await fetch(
      `${base}/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=media&fields=id`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': mimeType,
          'Content-Length': String(buf.byteLength),
        },
        body: buf,
      },
    );
    if (patchRes.ok) {
      const updated = (await patchRes.json()) as { id: string };
      return updated.id;
    }
  }

  const initRes = await fetch(
    `${base}/upload/drive/v3/files?uploadType=resumable&fields=id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(buf.byteLength),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
        mimeType,
      }),
    },
  );

  if (!initRes.ok) {
    throw parseDriveError(initRes.status, await initRes.text(), `Gagal menyimpan ${fileName}`);
  }
  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error(`URL upload ${fileName} tidak ditemukan.`);
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(buf.byteLength),
    },
    body: buf,
  });
  if (!putRes.ok) {
    throw parseDriveError(putRes.status, await putRes.text(), `Gagal menulis ${fileName}`);
  }
  const created = (await putRes.json()) as { id: string };
  await trySetFilePublicRead(accessToken, created.id);
  return created.id;
}

export async function listDriveFolderFilesRecursive(
  accessToken: string,
  rootFolderId: string,
  classFolderIds: Record<string, string> = {},
): Promise<DriveFileSummary[]> {
  const base = getDriveApiBase();
  const folderIds: Array<{ id: string; className?: string }> = [{ id: rootFolderId }];
  for (const [cls, fId] of Object.entries(classFolderIds)) {
    if (fId) folderIds.push({ id: fId, className: cls });
  }

  const collected: DriveFileSummary[] = [];
  const seen = new Set<string>();

  for (const target of folderIds) {
    const q = encodeURIComponent(
      `'${target.id}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder' and name != '${MANIFEST_FILE_NAME}'`,
    );
    const res = await fetch(
      `${base}/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,webViewLink,webContentLink,size,mimeType,createdTime)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      if (target.id === rootFolderId) {
        throw parseDriveError(res.status, await res.text(), 'Gagal membaca daftar file Drive');
      }
      continue;
    }
    const data = (await res.json()) as { files?: DriveFileSummary[] };
    for (const f of data.files ?? []) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        collected.push({
          ...f,
          className: target.className,
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        });
      }
    }
  }

  return collected;
}

export async function deleteDriveFile(
  accessToken: string,
  fileId: string,
): Promise<void> {
  const res = await fetch(
    `${getDriveApiBase()}/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    throw parseDriveError(res.status, await res.text(), 'Gagal menghapus file di Google Drive');
  }
}

export async function runFullDriveSync(params: {
  accessToken: string;
  ownerEmail?: string | null;
  driveConfig: DriveArchiveConfig;
  catalog: ArtworkGroup[];
  recapitulation: RecapitulationSummary;
  findUploadedFile: (groupId: string) => { path: string; mimeType: string } | null;
  applyOpenAccess?: boolean;
  forceArchiveDocs?: boolean;
}): Promise<{
  driveConfig: DriveArchiveConfig;
  syncedItems: Array<{
    groupId: string;
    driveFileId: string;
    driveWebViewLink: string;
    driveSyncedAt: string;
  }>;
  driveFiles: DriveFileSummary[];
  openAccessMessage?: string;
}> {
  const {
    accessToken,
    ownerEmail,
    driveConfig,
    catalog,
    recapitulation,
    findUploadedFile,
    applyOpenAccess = true,
    forceArchiveDocs = false,
  } = params;

  const rootFolder = await ensureRootFolder(
    accessToken,
    driveConfig.driveFolderId,
    applyOpenAccess,
  );

  const classFolderIds: Record<string, string> = {
    ...(driveConfig.classFolderIds ?? {}),
  };

  const pendingGroups = catalog.filter(
    (art) => Boolean(art.photoUrl) && !art.driveFileId,
  );

  const syncedItems: Array<{
    groupId: string;
    driveFileId: string;
    driveWebViewLink: string;
    driveSyncedAt: string;
  }> = [];

  const updatedCatalog = [...catalog];

  for (const art of pendingGroups) {
    const fileOnDisk = findUploadedFile(art.groupId);
    if (!fileOnDisk) continue;

    const classFolderId = await ensureClassSubfolder(
      accessToken,
      rootFolder.id,
      art.className,
      classFolderIds[art.className],
      applyOpenAccess,
    );
    classFolderIds[art.className] = classFolderId;

    const uploaded = await uploadBinaryFileToDrive(
      accessToken,
      classFolderId,
      art,
      fileOnDisk.path,
      art.originalFileName || `${art.groupId}.jpg`,
      art.originalMimeType || fileOnDisk.mimeType,
    );

    const syncedAt = new Date().toISOString();
    syncedItems.push({
      groupId: art.groupId,
      driveFileId: uploaded.id,
      driveWebViewLink: uploaded.webViewLink,
      driveSyncedAt: syncedAt,
    });

    const idx = updatedCatalog.findIndex((c) => c.groupId === art.groupId);
    if (idx >= 0) {
      updatedCatalog[idx] = {
        ...updatedCatalog[idx],
        driveFileId: uploaded.id,
        driveWebViewLink: uploaded.webViewLink,
        driveSyncedAt: syncedAt,
      };
    }
  }

  let manifestFileId = driveConfig.manifestFileId;
  let csvFileId = driveConfig.csvFileId ?? null;

  if (syncedItems.length > 0 || forceArchiveDocs || !manifestFileId || !csvFileId) {
    const manifestPayload = {
      folderName: TARGET_FOLDER_NAME,
      updatedAt: new Date().toISOString(),
      driveFolderUrl: rootFolder.webViewLink,
      classFolderIds,
      artworks: updatedCatalog.map((a) => ({
        groupId: a.groupId,
        className: a.className,
        grade: a.grade,
        memberNames: a.memberNames,
        artworkTitle: a.artworkTitle,
        leaves: a.leaves,
        technique: a.technique,
        fabric: a.fabric,
        mordant: a.mordant,
        description: a.description,
        originalFileName: a.originalFileName,
        originalFileSize: a.originalFileSize,
        driveFileId: a.driveFileId,
        driveWebViewLink: a.driveWebViewLink,
      })),
    };

    const [nextManifestId, nextCsvId] = await Promise.all([
      upsertTextFileToDrive(
        accessToken,
        rootFolder.id,
        MANIFEST_FILE_NAME,
        'application/json',
        JSON.stringify(manifestPayload, null, 2),
        manifestFileId,
      ),
      upsertTextFileToDrive(
        accessToken,
        rootFolder.id,
        CSV_ARCHIVE_FILE_NAME,
        'text/csv',
        buildCsvContent(updatedCatalog, recapitulation),
        csvFileId,
      ),
    ]);
    manifestFileId = nextManifestId;
    csvFileId = nextCsvId;
  }

  const driveFiles = await listDriveFolderFilesRecursive(
    accessToken,
    rootFolder.id,
    classFolderIds,
  );

  return {
    driveConfig: {
      driveFolderId: rootFolder.id,
      driveFolderUrl: rootFolder.webViewLink,
      driveOwnerEmail: ownerEmail ?? driveConfig.driveOwnerEmail,
      driveOpenAccessStatus: rootFolder.openAccessStatus,
      classFolderIds,
      manifestFileId,
      csvFileId,
      lastSyncedAt: new Date().toISOString(),
    },
    syncedItems,
    driveFiles,
    openAccessMessage: rootFolder.openAccessMessage,
  };
}
