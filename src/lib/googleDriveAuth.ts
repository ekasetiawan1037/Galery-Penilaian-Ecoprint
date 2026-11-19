import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  ArtworkGroup,
  RecapitulationSummary,
} from '../shared/ecoprint';

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
export const TARGET_FOLDER_NAME = 'galery penilaian Ecoprint';
export const DEFAULT_DRIVE_ACTIVATION_URL = `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${firebaseConfig.messagingSenderId}`;

export class GoogleDriveApiError extends Error {
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
    this.name = 'GoogleDriveApiError';
    this.status = status;
    this.reason = reason;
    this.activationUrl = activationUrl;
  }
}

function createGoogleProvider(): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  for (const scope of DRIVE_SCOPES) {
    p.addScope(scope);
  }
  p.setCustomParameters({
    login_hint: 'eka.setiawan1037@guru.smp.belajar.id',
    prompt: 'select_account',
  });
  return p;
}

// In-memory cache ONLY (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export function initGoogleDriveAuth(
  onAuthSuccess: (user: User, accessToken: string) => void,
  onAuthCleared: () => void,
) {
  return onAuthStateChanged(firebaseAuth, (user) => {
    if (user && cachedAccessToken) {
      onAuthSuccess(user, cachedAccessToken);
    } else if (!isSigningIn) {
      if (!user) {
        cachedAccessToken = null;
      }
      onAuthCleared();
    }
  });
}

export async function signInWithGoogleDrive(): Promise<{
  user: User;
  accessToken: string;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(firebaseAuth, createGoogleProvider());
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Gagal memperoleh token akses Google Drive. Pastikan izin akses Google Drive dicentang saat login.',
      );
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Popup login Google diblokir browser. Izinkan popup untuk situs ini lalu klik Sign in with Google lagi.',
      );
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Login Google Drive dibatalkan sebelum selesai.');
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'Domain aplikasi belum terdaftar di Firebase Auth authorizedDomains.',
      );
    }
    throw err instanceof Error
      ? err
      : new Error('Gagal menghubungkan akun Google Drive.');
  } finally {
    isSigningIn = false;
  }
}

export async function signOutGoogleDrive(): Promise<void> {
  await firebaseAuth.signOut();
  cachedAccessToken = null;
}

export function clearCachedDriveToken(): void {
  cachedAccessToken = null;
}

export function getCachedDriveToken(): string | null {
  return cachedAccessToken;
}

export interface DriveUploadedFileInfo {
  id: string;
  name: string;
  className?: string;
  webViewLink: string;
  webContentLink?: string;
  size?: string;
  mimeType?: string;
  createdTime?: string;
}

export function buildCatalogCsv(
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
