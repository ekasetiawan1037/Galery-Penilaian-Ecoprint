import {
  ALL_CLASSES,
  buildCatalogWithOverrides,
  computeRecapitulation,
  type ArtworkGroup,
  type ArtworkMetadataOverride,
  type AssessmentSubmission,
  type DriveArchiveConfig,
  type DriveOpenAccessStatus,
  type PhotoKind,
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
  fileBuffer: Buffer,
  originalFileName: string,
  mimeType: string,
  kind: PhotoKind = 'artwork',
): Promise<DriveFileSummary> {
  const base = getDriveApiBase();
  const safeTitle = group.artworkTitle.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Karya';
  const kindTag = kind === 'group' ? 'KELOMPOK' : 'KARYA';
  const kindDesc = kind === 'group' ? 'Foto Kelompok Bersama Karya' : 'Foto Karya Ecoprint';
  const driveName = `${group.groupId}_Kls${group.className}_${kindTag}_${safeTitle}_${originalFileName}`;
  const memberInfo = group.memberNames ? ` | Anggota: ${group.memberNames}` : '';

  const metadata = {
    name: driveName,
    parents: [targetFolderId],
    mimeType,
    description: `[${kindDesc}] Kelompok: ${group.groupId} | Kelas: ${group.className}${memberInfo} | Judul: ${group.artworkTitle} | Daun: ${group.leaves} | Teknik: ${group.technique}`,
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
    body: new Uint8Array(fileBuffer),
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
    'Nama File Karya Asli',
    'Ukuran Karya (Byte)',
    'Nama File Foto Kelompok',
    'Ukuran Foto Kelompok (Byte)',
    'Total Poin',
    'Jumlah Penilai',
    'Peringkat Jenjang',
    'Link Drive Foto Karya',
    'Link Drive Foto Kelompok',
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
      art.groupOriginalFileName ?? '',
      art.groupOriginalFileSize ?? '',
      score?.totalPoints ?? 0,
      score?.votesCount ?? 0,
      score?.gradeRank ?? '',
      art.driveWebViewLink ?? '',
      art.groupDriveWebViewLink ?? '',
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
        body: new Uint8Array(buf),
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
    body: new Uint8Array(buf),
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

export async function syncSingleGroupToDrive(params: {
  accessToken: string;
  ownerEmail?: string | null;
  driveConfig: DriveArchiveConfig;
  group: ArtworkGroup;
  artworkFile?: { buffer: Buffer; originalFileName: string; mimeType: string } | null;
  groupFile?: { buffer: Buffer; originalFileName: string; mimeType: string } | null;
}): Promise<{
  driveConfig: DriveArchiveConfig;
  artworkResult?: {
    driveFileId: string;
    driveWebViewLink: string;
    driveSyncedAt: string;
  };
  groupResult?: {
    driveFileId: string;
    driveWebViewLink: string;
    driveSyncedAt: string;
  };
}> {
  const { accessToken, ownerEmail, driveConfig, group, artworkFile, groupFile } = params;

  const rootFolder = await ensureRootFolder(
    accessToken,
    driveConfig.driveFolderId,
    true,
  );
  const classFolderIds: Record<string, string> = {
    ...(driveConfig.classFolderIds ?? {}),
  };
  const classFolderId = await ensureClassSubfolder(
    accessToken,
    rootFolder.id,
    group.className,
    classFolderIds[group.className],
    true,
  );
  classFolderIds[group.className] = classFolderId;

  let artworkResult:
    | { driveFileId: string; driveWebViewLink: string; driveSyncedAt: string }
    | undefined;
  let groupResult:
    | { driveFileId: string; driveWebViewLink: string; driveSyncedAt: string }
    | undefined;

  if (artworkFile) {
    const uploaded = await uploadBinaryFileToDrive(
      accessToken,
      classFolderId,
      group,
      artworkFile.buffer,
      artworkFile.originalFileName,
      artworkFile.mimeType,
      'artwork',
    );
    artworkResult = {
      driveFileId: uploaded.id,
      driveWebViewLink: uploaded.webViewLink,
      driveSyncedAt: new Date().toISOString(),
    };
  }

  if (groupFile) {
    const uploaded = await uploadBinaryFileToDrive(
      accessToken,
      classFolderId,
      group,
      groupFile.buffer,
      groupFile.originalFileName,
      groupFile.mimeType,
      'group',
    );
    groupResult = {
      driveFileId: uploaded.id,
      driveWebViewLink: uploaded.webViewLink,
      driveSyncedAt: new Date().toISOString(),
    };
  }

  return {
    driveConfig: {
      ...driveConfig,
      driveFolderId: rootFolder.id,
      driveFolderUrl: rootFolder.webViewLink,
      driveOwnerEmail: ownerEmail ?? driveConfig.driveOwnerEmail,
      driveOpenAccessStatus: rootFolder.openAccessStatus,
      classFolderIds,
      lastSyncedAt: new Date().toISOString(),
    },
    artworkResult,
    groupResult,
  };
}

export async function uploadViaAppsScriptWebhook(
  webhookUrl: string,
  params: {
    group: ArtworkGroup;
    kind: PhotoKind;
    buffer: Buffer;
    originalFileName: string;
    mimeType: string;
  },
): Promise<{
  driveFileId: string;
  driveWebViewLink: string;
  driveSyncedAt: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
  driveOwnerEmail?: string;
}> {
  const { group, kind, buffer, originalFileName, mimeType } = params;
  const safeTitle = group.artworkTitle.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Karya';
  const kindTag = kind === 'group' ? 'KELOMPOK' : 'KARYA';
  const driveName = `${group.groupId}_Kls${group.className}_${kindTag}_${safeTitle}_${originalFileName}`;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({
      folderName: TARGET_FOLDER_NAME,
      classFolderName: `Kelas ${group.className}`,
      groupId: group.groupId,
      className: group.className,
      kind,
      fileName: driveName,
      mimeType,
      base64: buffer.toString('base64'),
      memberNames: group.memberNames,
      artworkTitle: group.artworkTitle,
      leaves: group.leaves,
      technique: group.technique,
    }),
  });

  if (!res.ok) {
    throw new ServerDriveApiError(
      `Apps Script bridge mengembalikan status HTTP ${res.status}.`,
      res.status,
    );
  }

  const data = (await res.json()) as {
    ok?: boolean;
    fileId?: string;
    webViewLink?: string;
    folderId?: string;
    folderUrl?: string;
    ownerEmail?: string;
    error?: string;
  };

  if (!data.ok || !data.fileId) {
    throw new Error(data.error || 'Apps Script tidak mengembalikan ID file Drive.');
  }

  return {
    driveFileId: data.fileId,
    driveWebViewLink:
      data.webViewLink || `https://drive.google.com/file/d/${data.fileId}/view`,
    driveSyncedAt: new Date().toISOString(),
    driveFolderId: data.folderId,
    driveFolderUrl: data.folderUrl,
    driveOwnerEmail: data.ownerEmail,
  };
}

export interface DriveArchiveManifest {
  version?: number;
  folderName: string;
  updatedAt: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
  classFolderIds?: Record<string, string>;
  submissions?: AssessmentSubmission[];
  artworks?: Array<{
    groupId: string;
    className?: string;
    grade?: number;
    memberNames?: string;
    artworkTitle?: string;
    leaves?: string;
    technique?: string;
    fabric?: string;
    mordant?: string;
    description?: string;
    metadataUpdatedAt?: string | null;
    photoUrl?: string | null;
    photoUpdatedAt?: string | null;
    originalFileName?: string | null;
    originalFileSize?: number | null;
    originalMimeType?: string | null;
    driveFileId?: string | null;
    driveWebViewLink?: string | null;
    driveSyncedAt?: string | null;
    groupPhotoUrl?: string | null;
    groupPhotoUpdatedAt?: string | null;
    groupOriginalFileName?: string | null;
    groupOriginalFileSize?: number | null;
    groupOriginalMimeType?: string | null;
    groupDriveFileId?: string | null;
    groupDriveWebViewLink?: string | null;
    groupDriveSyncedAt?: string | null;
  }>;
}

export async function discoverClassSubfolders(
  accessToken: string,
  rootFolderId: string,
  existingClassFolderIds: Record<string, string> = {},
): Promise<Record<string, string>> {
  const base = getDriveApiBase();
  const nextIds: Record<string, string> = { ...existingClassFolderIds };
  try {
    const q = encodeURIComponent(
      `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const res = await fetch(
      `${base}/drive/v3/files?q=${q}&pageSize=50&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return nextIds;
    const data = (await res.json()) as {
      files?: Array<{ id: string; name: string }>;
    };
    const classNamesSet = new Set(ALL_CLASSES.map((c) => c.className));
    for (const f of data.files ?? []) {
      const m = f.name.match(/^Kelas\s+(\d{2})$/i);
      if (m && classNamesSet.has(m[1])) {
        nextIds[m[1]] = f.id;
      }
    }
  } catch {
    // Non-fatal
  }
  return nextIds;
}

export async function readDriveManifestSnapshot(
  accessToken: string,
  rootFolderId: string,
  existingManifestFileId?: string | null,
): Promise<{ manifest: DriveArchiveManifest | null; manifestFileId: string | null }> {
  const base = getDriveApiBase();
  let fileId = existingManifestFileId ?? null;

  if (fileId) {
    try {
      const res = await fetch(
        `${base}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (res.ok) {
        const parsed = (await res.json()) as DriveArchiveManifest;
        return { manifest: parsed, manifestFileId: fileId };
      }
    } catch {
      fileId = null;
    }
  }

  try {
    const q = encodeURIComponent(
      `'${rootFolderId}' in parents and name='${MANIFEST_FILE_NAME}' and trashed=false`,
    );
    const searchRes = await fetch(
      `${base}/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!searchRes.ok) return { manifest: null, manifestFileId: fileId };
    const searchData = (await searchRes.json()) as {
      files?: Array<{ id: string; name: string }>;
    };
    const foundId = searchData.files?.[0]?.id;
    if (!foundId) return { manifest: null, manifestFileId: null };

    const downloadRes = await fetch(
      `${base}/drive/v3/files/${encodeURIComponent(foundId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!downloadRes.ok) return { manifest: null, manifestFileId: foundId };
    const parsed = (await downloadRes.json()) as DriveArchiveManifest;
    return { manifest: parsed, manifestFileId: foundId };
  } catch {
    return { manifest: null, manifestFileId: fileId };
  }
}

function parseTimestamp(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export function mergeDriveDataIntoState(params: {
  localArtworksMeta: Record<string, ArtworkMetadataOverride>;
  localSubmissions: AssessmentSubmission[];
  remoteManifest: DriveArchiveManifest | null;
  remoteDriveFiles: DriveFileSummary[];
}): {
  mergedArtworksMeta: Record<string, ArtworkMetadataOverride>;
  mergedSubmissions: AssessmentSubmission[];
  pulledGroupsCount: number;
  pulledVotesCount: number;
} {
  const {
    localArtworksMeta,
    localSubmissions,
    remoteManifest,
    remoteDriveFiles,
  } = params;

  const mergedMeta: Record<string, ArtworkMetadataOverride> = {};
  for (const [k, v] of Object.entries(localArtworksMeta)) {
    mergedMeta[k] = { ...v };
  }

  let pulledGroupsCount = 0;
  const remoteUpdatedMs = parseTimestamp(remoteManifest?.updatedAt);

  // 1) Merge metadata & Drive links from remote Drive manifest
  for (const item of remoteManifest?.artworks ?? []) {
    if (!item?.groupId) continue;
    const local = mergedMeta[item.groupId] ?? {};
    const next: ArtworkMetadataOverride = { ...local };
    let changedFromDrive = false;

    const remoteMetaMs =
      parseTimestamp(item.metadataUpdatedAt) || remoteUpdatedMs;
    const localMetaMs = parseTimestamp(local.metadataUpdatedAt);

    // Pull descriptive text fields if server doesn't have custom overrides OR Drive snapshot is strictly newer
    const hasLocalCustomMeta = Boolean(
      local.metadataUpdatedAt ||
        local.memberNames ||
        local.artworkTitle ||
        local.leaves ||
        local.description,
    );
    const shouldTakeRemoteText =
      !hasLocalCustomMeta || (remoteMetaMs > 0 && remoteMetaMs > localMetaMs);

    if (shouldTakeRemoteText) {
      if (item.memberNames !== undefined && item.memberNames !== local.memberNames) {
        next.memberNames = item.memberNames;
        changedFromDrive = true;
      }
      if (item.artworkTitle && item.artworkTitle !== local.artworkTitle) {
        next.artworkTitle = item.artworkTitle;
        changedFromDrive = true;
      }
      if (item.leaves && item.leaves !== local.leaves) {
        next.leaves = item.leaves;
        changedFromDrive = true;
      }
      if (item.technique && item.technique !== local.technique) {
        next.technique = item.technique;
        changedFromDrive = true;
      }
      if (item.fabric && item.fabric !== local.fabric) {
        next.fabric = item.fabric;
        changedFromDrive = true;
      }
      if (item.mordant && item.mordant !== local.mordant) {
        next.mordant = item.mordant;
        changedFromDrive = true;
      }
      if (item.description && item.description !== local.description) {
        next.description = item.description;
        changedFromDrive = true;
      }
      if (item.metadataUpdatedAt || changedFromDrive) {
        next.metadataUpdatedAt = item.metadataUpdatedAt ?? remoteManifest?.updatedAt ?? null;
      }
    }

    // Pull Foto Karya Drive pointers if missing locally (or Drive photo is newer and local doesn't have an unsynced upload)
    const hasUnsyncedLocalArtwork = Boolean(local.photoUrl && !local.driveFileId);
    const remoteArtPhotoMs = parseTimestamp(item.photoUpdatedAt || item.driveSyncedAt);
    const localArtPhotoMs = parseTimestamp(local.photoUpdatedAt || local.driveSyncedAt);

    if (
      item.driveFileId &&
      !hasUnsyncedLocalArtwork &&
      (!local.driveFileId || remoteArtPhotoMs > localArtPhotoMs)
    ) {
      if (next.driveFileId !== item.driveFileId) {
        changedFromDrive = true;
      }
      next.driveFileId = item.driveFileId;
      next.driveWebViewLink =
        item.driveWebViewLink || `https://drive.google.com/file/d/${item.driveFileId}/view`;
      next.driveSyncedAt = item.driveSyncedAt ?? remoteManifest?.updatedAt ?? null;
      if (item.originalFileName) next.originalFileName = item.originalFileName;
      if (item.originalFileSize) next.originalFileSize = item.originalFileSize;
      if (item.originalMimeType) next.originalMimeType = item.originalMimeType;
      if (item.photoUpdatedAt && !next.photoUpdatedAt) {
        next.photoUpdatedAt = item.photoUpdatedAt;
      }
    }

    // Pull Foto Kelompok Drive pointers if missing locally
    const hasUnsyncedLocalGroup = Boolean(local.groupPhotoUrl && !local.groupDriveFileId);
    const remoteGrpPhotoMs = parseTimestamp(
      item.groupPhotoUpdatedAt || item.groupDriveSyncedAt,
    );
    const localGrpPhotoMs = parseTimestamp(
      local.groupPhotoUpdatedAt || local.groupDriveSyncedAt,
    );

    if (
      item.groupDriveFileId &&
      !hasUnsyncedLocalGroup &&
      (!local.groupDriveFileId || remoteGrpPhotoMs > localGrpPhotoMs)
    ) {
      if (next.groupDriveFileId !== item.groupDriveFileId) {
        changedFromDrive = true;
      }
      next.groupDriveFileId = item.groupDriveFileId;
      next.groupDriveWebViewLink =
        item.groupDriveWebViewLink ||
        `https://drive.google.com/file/d/${item.groupDriveFileId}/view`;
      next.groupDriveSyncedAt = item.groupDriveSyncedAt ?? remoteManifest?.updatedAt ?? null;
      if (item.groupOriginalFileName) next.groupOriginalFileName = item.groupOriginalFileName;
      if (item.groupOriginalFileSize) next.groupOriginalFileSize = item.groupOriginalFileSize;
      if (item.groupOriginalMimeType) next.groupOriginalMimeType = item.groupOriginalMimeType;
      if (item.groupPhotoUpdatedAt && !next.groupPhotoUpdatedAt) {
        next.groupPhotoUpdatedAt = item.groupPhotoUpdatedAt;
      }
    }

    if (changedFromDrive) {
      pulledGroupsCount++;
      mergedMeta[item.groupId] = next;
    } else if (Object.keys(next).length > 0) {
      mergedMeta[item.groupId] = next;
    }
  }

  // 2) Also scan actual binary files directly in Drive folders (in case files exist without manifest entry)
  for (const f of remoteDriveFiles) {
    const match = f.name.match(/^(\d{2}-\d+)_Kls\d{2}_(KARYA|KELOMPOK)_/i);
    if (!match) continue;
    const groupId = match[1];
    const kindTag = match[2].toUpperCase();
    const current = mergedMeta[groupId] ?? {};

    if (kindTag === 'KARYA' && !current.driveFileId && !current.photoUrl) {
      mergedMeta[groupId] = {
        ...current,
        driveFileId: f.id,
        driveWebViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        driveSyncedAt: f.createdTime ?? new Date().toISOString(),
        originalFileName: current.originalFileName ?? f.name,
        originalFileSize: current.originalFileSize ?? (f.size ? Number(f.size) : null),
        originalMimeType: current.originalMimeType ?? f.mimeType ?? null,
      };
      pulledGroupsCount++;
    } else if (
      kindTag === 'KELOMPOK' &&
      !current.groupDriveFileId &&
      !current.groupPhotoUrl
    ) {
      mergedMeta[groupId] = {
        ...current,
        groupDriveFileId: f.id,
        groupDriveWebViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        groupDriveSyncedAt: f.createdTime ?? new Date().toISOString(),
        groupOriginalFileName: current.groupOriginalFileName ?? f.name,
        groupOriginalFileSize:
          current.groupOriginalFileSize ?? (f.size ? Number(f.size) : null),
        groupOriginalMimeType: current.groupOriginalMimeType ?? f.mimeType ?? null,
      };
      pulledGroupsCount++;
    }
  }

  // 3) Union locked assessment submissions from Drive manifest + local server DB
  const submissionMap = new Map<string, AssessmentSubmission>();
  for (const sub of remoteManifest?.submissions ?? []) {
    if (sub?.evaluatorGroupId && Array.isArray(sub.votes)) {
      submissionMap.set(sub.evaluatorGroupId, sub);
    }
  }
  const localIds = new Set(localSubmissions.map((s) => s.evaluatorGroupId));
  let pulledVotesCount = 0;
  for (const [gid] of submissionMap.entries()) {
    if (!localIds.has(gid)) {
      pulledVotesCount++;
    }
  }
  for (const sub of localSubmissions) {
    if (sub?.evaluatorGroupId) {
      submissionMap.set(sub.evaluatorGroupId, sub);
    }
  }

  return {
    mergedArtworksMeta: mergedMeta,
    mergedSubmissions: Array.from(submissionMap.values()),
    pulledGroupsCount,
    pulledVotesCount,
  };
}

export function buildDriveManifestPayload(params: {
  rootFolderId?: string | null;
  rootFolderUrl?: string | null;
  classFolderIds?: Record<string, string>;
  artworksMeta: Record<string, ArtworkMetadataOverride>;
  submissions: AssessmentSubmission[];
}): DriveArchiveManifest {
  const catalog = buildCatalogWithOverrides(params.artworksMeta);
  return {
    version: 2,
    folderName: TARGET_FOLDER_NAME,
    updatedAt: new Date().toISOString(),
    ...(params.rootFolderId ? { driveFolderId: params.rootFolderId } : {}),
    ...(params.rootFolderUrl ? { driveFolderUrl: params.rootFolderUrl } : {}),
    classFolderIds: params.classFolderIds ?? {},
    submissions: params.submissions,
    artworks: catalog.map((a) => {
      const ov = params.artworksMeta[a.groupId];
      return {
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
        metadataUpdatedAt: ov?.metadataUpdatedAt ?? null,
        photoUrl: a.photoUrl,
        photoUpdatedAt: a.photoUpdatedAt,
        originalFileName: a.originalFileName,
        originalFileSize: a.originalFileSize,
        originalMimeType: a.originalMimeType,
        driveFileId: a.driveFileId,
        driveWebViewLink: a.driveWebViewLink,
        driveSyncedAt: a.driveSyncedAt,
        groupPhotoUrl: a.groupPhotoUrl,
        groupPhotoUpdatedAt: a.groupPhotoUpdatedAt,
        groupOriginalFileName: a.groupOriginalFileName,
        groupOriginalFileSize: a.groupOriginalFileSize,
        groupOriginalMimeType: a.groupOriginalMimeType,
        groupDriveFileId: a.groupDriveFileId,
        groupDriveWebViewLink: a.groupDriveWebViewLink,
        groupDriveSyncedAt: a.groupDriveSyncedAt,
      };
    }),
  };
}

export async function writeDriveManifestAndCsv(params: {
  accessToken: string;
  driveConfig: DriveArchiveConfig;
  artworksMeta: Record<string, ArtworkMetadataOverride>;
  submissions: AssessmentSubmission[];
  ownerEmail?: string | null;
}): Promise<DriveArchiveConfig> {
  const { accessToken, driveConfig, artworksMeta, submissions, ownerEmail } = params;
  const rootFolder = await ensureRootFolder(
    accessToken,
    driveConfig.driveFolderId,
    false,
  );
  const catalog = buildCatalogWithOverrides(artworksMeta);
  const recapitulation = computeRecapitulation(submissions, catalog);

  const manifestPayload = buildDriveManifestPayload({
    rootFolderId: rootFolder.id,
    rootFolderUrl: rootFolder.webViewLink,
    classFolderIds: driveConfig.classFolderIds ?? {},
    artworksMeta,
    submissions,
  });

  const [nextManifestId, nextCsvId] = await Promise.all([
    upsertTextFileToDrive(
      accessToken,
      rootFolder.id,
      MANIFEST_FILE_NAME,
      'application/json',
      JSON.stringify(manifestPayload, null, 2),
      driveConfig.manifestFileId,
    ),
    upsertTextFileToDrive(
      accessToken,
      rootFolder.id,
      CSV_ARCHIVE_FILE_NAME,
      'text/csv',
      buildCsvContent(catalog, recapitulation),
      driveConfig.csvFileId,
    ),
  ]);

  return {
    ...driveConfig,
    driveFolderId: rootFolder.id,
    driveFolderUrl: rootFolder.webViewLink,
    driveOwnerEmail: ownerEmail ?? driveConfig.driveOwnerEmail,
    manifestFileId: nextManifestId,
    csvFileId: nextCsvId,
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function syncManifestViaAppsScriptWebhook(
  webhookUrl: string,
  params: {
    artworksMeta: Record<string, ArtworkMetadataOverride>;
    submissions: AssessmentSubmission[];
    driveConfig: DriveArchiveConfig;
  },
): Promise<{
  driveFolderId?: string;
  driveFolderUrl?: string;
  manifestFileId?: string;
  csvFileId?: string;
}> {
  const catalog = buildCatalogWithOverrides(params.artworksMeta);
  const recapitulation = computeRecapitulation(params.submissions, catalog);
  const manifestPayload = buildDriveManifestPayload({
    rootFolderId: params.driveConfig.driveFolderId,
    rootFolderUrl: params.driveConfig.driveFolderUrl,
    classFolderIds: params.driveConfig.classFolderIds,
    artworksMeta: params.artworksMeta,
    submissions: params.submissions,
  });

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({
      action: 'sync_manifest',
      folderName: TARGET_FOLDER_NAME,
      manifestFileName: MANIFEST_FILE_NAME,
      manifestContent: JSON.stringify(manifestPayload, null, 2),
      csvFileName: CSV_ARCHIVE_FILE_NAME,
      csvContent: buildCsvContent(catalog, recapitulation),
    }),
  });

  if (!res.ok) {
    throw new ServerDriveApiError(
      `Apps Script bridge mengembalikan status HTTP ${res.status}.`,
      res.status,
    );
  }
  const data = (await res.json()) as {
    ok?: boolean;
    folderId?: string;
    folderUrl?: string;
    manifestFileId?: string;
    csvFileId?: string;
  };
  return {
    driveFolderId: data.folderId,
    driveFolderUrl: data.folderUrl,
    manifestFileId: data.manifestFileId,
    csvFileId: data.csvFileId,
  };
}

export async function runFullDriveSync(params: {
  accessToken: string;
  ownerEmail?: string | null;
  driveConfig: DriveArchiveConfig;
  artworksMeta: Record<string, ArtworkMetadataOverride>;
  submissions: AssessmentSubmission[];
  readUploadedFileBuffer: (
    groupId: string,
    kind: PhotoKind,
  ) => Promise<{ buffer: Buffer; mimeType: string } | null>;
  applyOpenAccess?: boolean;
  forceArchiveDocs?: boolean;
  pullFromDrive?: boolean;
}): Promise<{
  driveConfig: DriveArchiveConfig;
  mergedArtworksMeta: Record<string, ArtworkMetadataOverride>;
  mergedSubmissions: AssessmentSubmission[];
  pulledGroupsCount: number;
  pulledVotesCount: number;
  syncedItems: Array<{
    groupId: string;
    kind: PhotoKind;
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
    artworksMeta,
    submissions,
    readUploadedFileBuffer,
    applyOpenAccess = true,
    forceArchiveDocs = false,
    pullFromDrive = true,
  } = params;

  const rootFolder = await ensureRootFolder(
    accessToken,
    driveConfig.driveFolderId,
    applyOpenAccess,
  );

  let classFolderIds = await discoverClassSubfolders(
    accessToken,
    rootFolder.id,
    driveConfig.classFolderIds ?? {},
  );

  // 1) PULL FROM GOOGLE DRIVE FIRST when Admin connects/logs in
  let mergedArtworksMeta: Record<string, ArtworkMetadataOverride> = {};
  for (const [k, v] of Object.entries(artworksMeta)) {
    mergedArtworksMeta[k] = { ...v };
  }
  let mergedSubmissions = [...submissions];
  let pulledGroupsCount = 0;
  let pulledVotesCount = 0;
  let manifestFileId = driveConfig.manifestFileId;

  const existingDriveFiles = await listDriveFolderFilesRecursive(
    accessToken,
    rootFolder.id,
    classFolderIds,
  );

  if (pullFromDrive) {
    const remoteManifestRes = await readDriveManifestSnapshot(
      accessToken,
      rootFolder.id,
      manifestFileId,
    );
    if (remoteManifestRes.manifestFileId) {
      manifestFileId = remoteManifestRes.manifestFileId;
    }
    if (remoteManifestRes.manifest?.classFolderIds) {
      classFolderIds = {
        ...remoteManifestRes.manifest.classFolderIds,
        ...classFolderIds,
      };
    }
    const merged = mergeDriveDataIntoState({
      localArtworksMeta: mergedArtworksMeta,
      localSubmissions: mergedSubmissions,
      remoteManifest: remoteManifestRes.manifest,
      remoteDriveFiles: existingDriveFiles,
    });
    mergedArtworksMeta = merged.mergedArtworksMeta;
    mergedSubmissions = merged.mergedSubmissions;
    pulledGroupsCount = merged.pulledGroupsCount;
    pulledVotesCount = merged.pulledVotesCount;
  }

  // 2) PUSH PENDING LOCAL PHOTOS (including offline uploads made while Admin was off) to Drive
  const syncedItems: Array<{
    groupId: string;
    kind: PhotoKind;
    driveFileId: string;
    driveWebViewLink: string;
    driveSyncedAt: string;
  }> = [];

  const updatedCatalog = buildCatalogWithOverrides(mergedArtworksMeta);

  for (let i = 0; i < updatedCatalog.length; i++) {
    let art = updatedCatalog[i];
    const needsArtwork = Boolean(art.photoUrl) && !art.driveFileId;
    const needsGroup = Boolean(art.groupPhotoUrl) && !art.groupDriveFileId;
    if (!needsArtwork && !needsGroup) continue;

    let classFolderId = classFolderIds[art.className];
    const ensureClassDir = async () => {
      if (!classFolderId) {
        classFolderId = await ensureClassSubfolder(
          accessToken,
          rootFolder.id,
          art.className,
          classFolderIds[art.className],
          applyOpenAccess,
        );
        classFolderIds[art.className] = classFolderId;
      }
      return classFolderId;
    };

    if (needsArtwork) {
      const fileData = await readUploadedFileBuffer(art.groupId, 'artwork');
      if (fileData) {
        const folderId = await ensureClassDir();
        const uploaded = await uploadBinaryFileToDrive(
          accessToken,
          folderId,
          art,
          fileData.buffer,
          art.originalFileName || `${art.groupId}.jpg`,
          art.originalMimeType || fileData.mimeType,
          'artwork',
        );
        const syncedAt = new Date().toISOString();
        syncedItems.push({
          groupId: art.groupId,
          kind: 'artwork',
          driveFileId: uploaded.id,
          driveWebViewLink: uploaded.webViewLink,
          driveSyncedAt: syncedAt,
        });
        mergedArtworksMeta[art.groupId] = {
          ...(mergedArtworksMeta[art.groupId] ?? {}),
          driveFileId: uploaded.id,
          driveWebViewLink: uploaded.webViewLink,
          driveSyncedAt: syncedAt,
        };
        art = {
          ...art,
          driveFileId: uploaded.id,
          driveWebViewLink: uploaded.webViewLink,
          driveSyncedAt: syncedAt,
        };
      }
    }

    if (needsGroup) {
      const groupData = await readUploadedFileBuffer(art.groupId, 'group');
      if (groupData) {
        const folderId = await ensureClassDir();
        const uploaded = await uploadBinaryFileToDrive(
          accessToken,
          folderId,
          art,
          groupData.buffer,
          art.groupOriginalFileName || `${art.groupId}_kelompok.jpg`,
          art.groupOriginalMimeType || groupData.mimeType,
          'group',
        );
        const syncedAt = new Date().toISOString();
        syncedItems.push({
          groupId: art.groupId,
          kind: 'group',
          driveFileId: uploaded.id,
          driveWebViewLink: uploaded.webViewLink,
          driveSyncedAt: syncedAt,
        });
        mergedArtworksMeta[art.groupId] = {
          ...(mergedArtworksMeta[art.groupId] ?? {}),
          groupDriveFileId: uploaded.id,
          groupDriveWebViewLink: uploaded.webViewLink,
          groupDriveSyncedAt: syncedAt,
        };
        art = {
          ...art,
          groupDriveFileId: uploaded.id,
          groupDriveWebViewLink: uploaded.webViewLink,
          groupDriveSyncedAt: syncedAt,
        };
      }
    }

    updatedCatalog[i] = art;
  }

  let csvFileId = driveConfig.csvFileId ?? null;
  const recapitulation = computeRecapitulation(mergedSubmissions, updatedCatalog);

  // 3) ALWAYS WRITE UPDATED COMPLETE SNAPSHOT (manifest.json + CSV) back to Google Drive
  if (
    syncedItems.length > 0 ||
    pulledGroupsCount > 0 ||
    pulledVotesCount > 0 ||
    forceArchiveDocs ||
    !manifestFileId ||
    !csvFileId
  ) {
    const manifestPayload = buildDriveManifestPayload({
      rootFolderId: rootFolder.id,
      rootFolderUrl: rootFolder.webViewLink,
      classFolderIds,
      artworksMeta: mergedArtworksMeta,
      submissions: mergedSubmissions,
    });

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
      ...driveConfig,
      driveFolderId: rootFolder.id,
      driveFolderUrl: rootFolder.webViewLink,
      driveOwnerEmail: ownerEmail ?? driveConfig.driveOwnerEmail,
      driveOpenAccessStatus: rootFolder.openAccessStatus,
      classFolderIds,
      manifestFileId,
      csvFileId,
      lastSyncedAt: new Date().toISOString(),
    },
    mergedArtworksMeta,
    mergedSubmissions,
    pulledGroupsCount,
    pulledVotesCount,
    syncedItems,
    driveFiles,
    openAccessMessage: rootFolder.openAccessMessage,
  };
}
