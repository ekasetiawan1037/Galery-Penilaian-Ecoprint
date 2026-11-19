import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Printer,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
} from 'lucide-react';
import {
  buildCatalogCsv,
  TARGET_FOLDER_NAME,
  type DriveUploadedFileInfo,
} from '../lib/googleDriveAuth';
import {
  ALL_CLASSES,
  type ArtworkGroup,
  type AssessmentSubmission,
  type DriveArchiveConfig,
  type RecapitulationSummary,
} from '../shared/ecoprint';

interface RuntimeStorageInfo {
  isVercel: boolean;
  storagePersistent: boolean;
  storageProvider: 'local-disk' | 'upstash-redis' | 'vercel-tmp';
}

interface AdminViewProps {
  adminToken: string | null;
  catalog: ArtworkGroup[];
  submissions: AssessmentSubmission[];
  recapitulation: RecapitulationSummary;
  driveConfig: DriveArchiveConfig;
  runtimeInfo?: RuntimeStorageInfo | null;
  driveUser: User | null;
  driveAccessToken: string | null;
  driveError: string | null;
  driveActivationUrl: string | null;
  isSyncingDrive: boolean;
  driveFolderFiles: DriveUploadedFileInfo[];
  isBusy: boolean;
  onAdminLoginSuccess: (token: string) => void;
  onAdminLogout: () => void;
  onGoogleDriveSignIn: () => Promise<void>;
  onGoogleDriveSignOut: () => Promise<void>;
  onSyncAllToDrive: () => Promise<void>;
  onRetryDriveSync: () => Promise<void>;
  onConfigureOpenAccess: () => Promise<void>;
  onRefreshDriveFiles: () => Promise<void>;
  onOpenPrintablePasswords: () => void;
  onSeedDemo: () => Promise<void>;
  onResetAll: () => Promise<void>;
  onUnlockGroup: (groupId: string) => Promise<void>;
}

const TEACHER_EXPECTED_EMAIL = 'eka.setiawan1037@guru.smp.belajar.id';

function formatBytes(bytes?: number | string | null): string {
  const num = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!num || num <= 0) return '-';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

export const AdminView: React.FC<AdminViewProps> = ({
  adminToken,
  catalog,
  submissions,
  recapitulation,
  driveConfig,
  runtimeInfo,
  driveUser,
  driveAccessToken,
  driveError,
  driveActivationUrl,
  isSyncingDrive,
  driveFolderFiles,
  isBusy,
  onAdminLoginSuccess,
  onAdminLogout,
  onGoogleDriveSignIn,
  onGoogleDriveSignOut,
  onSyncAllToDrive,
  onRetryDriveSync,
  onConfigureOpenAccess,
  onRefreshDriveFiles,
  onOpenPrintablePasswords,
  onSeedDemo,
  onResetAll,
  onUnlockGroup,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmSyncOverwriteOpen, setConfirmSyncOverwriteOpen] = useState(false);
  const [confirmOpenAccessModal, setConfirmOpenAccessModal] = useState(false);

  const handleDownloadCsv = () => {
    const csv = buildCatalogCsv(catalog, recapitulation);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Rekap_Karya_Ecoprint.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const lockedIds = new Set(submissions.map((s) => s.evaluatorGroupId));
  const uploadedArtworks = catalog.filter(
    (g) => Boolean(g.photoUrl || g.driveWebViewLink),
  );
  const pendingDriveCount = catalog.filter(
    (g) => Boolean(g.photoUrl) && !g.driveFileId,
  ).length;
  const isWrongDriveAccount =
    Boolean(driveUser?.email) &&
    driveUser?.email?.toLowerCase() !== TEACHER_EXPECTED_EMAIL.toLowerCase();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setLoginError('Masukkan password admin guru.');
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error ?? 'Password admin salah.');
        return;
      }
      setPassword('');
      onAdminLoginSuccess(data.token);
    } catch {
      setLoginError('Gagal menghubungi server.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (!adminToken) {
    return (
      <section className="max-w-md mx-auto my-12 bg-white border border-[#E3DED4] rounded-xl p-6 sm:p-8">
        <div className="flex items-center gap-2.5 text-[#1B4332]">
          <ShieldCheck className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold">Khusus Guru / Panitia</span>
        </div>

        <h1 className="font-editorial text-2xl font-semibold text-[#1A1917] mt-2">
          Masuk Panel Admin Guru
        </h1>
        <p className="text-sm text-[#5E5A52] mt-1.5 leading-relaxed">
          Menu cetak seluruh password kelompok, sinkronisasi Google Drive, dan pengelolaan sesi penilaian hanya dapat diakses oleh guru.
        </p>

        <form onSubmit={handleLogin} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="teacher-admin-password"
              className="block text-xs font-semibold text-[#1A1917] mb-1.5"
            >
              Password Admin Guru
            </label>
            <div className="relative">
              <KeyRound
                className="w-4 h-4 text-[#5E5A52] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="teacher-admin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password admin..."
                className="w-full pl-9 pr-10 py-2.5 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg text-[#1A1917]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#5E5A52] hover:text-[#1A1917]"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {loginError && (
            <p className="text-xs font-medium text-[#991B1B]" role="alert">
              {loginError}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full py-2.5 px-4 rounded-lg bg-[#1B4332] hover:bg-[#143326] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
          >
            {isLoggingIn ? 'Memverifikasi...' : 'Masuk Panel Admin'}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      {/* Admin Header */}
      <div className="border-b border-[#E3DED4] pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#1B4332]">
            Panel Kontrol Guru &amp; Panitia
          </p>
          <h1 className="font-editorial text-3xl sm:text-4xl font-semibold text-[#1A1917] mt-1">
            Administrasi Penilaian, Password &amp; Google Drive
          </h1>
          <p className="text-sm text-[#5E5A52] mt-2 max-w-2xl leading-relaxed">
            Cetak seluruh password kelompok dalam satu halaman, hubungkan Google Drive untuk menyimpan foto ukuran asli secara permanen, dan buka kembali tautan file Drive dari web.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenPrintablePasswords}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#1B4332] text-white hover:bg-[#143326] transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            <span>Cetak Semua Password (1 Halaman)</span>
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={onSeedDemo}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border border-[#1B4332] bg-white text-[#1B4332] hover:bg-[#F2F7F4] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Simulasi +10 Suara</span>
          </button>

          <button
            type="button"
            disabled={isBusy || submissions.length === 0}
            onClick={() => setConfirmResetOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-[#991B1B] hover:bg-[#FEE2E2] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reset Semua Penilaian</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border border-[#E3DED4] bg-white text-[#1A1917] hover:bg-[#F0EDE6] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Unduh Rekap (.CSV)</span>
          </button>

          <button
            type="button"
            onClick={onAdminLogout}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border border-[#E3DED4] bg-white text-[#1A1917] hover:bg-[#F0EDE6] transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Keluar Admin</span>
          </button>
        </div>
      </div>

      {/* Vercel / Storage Persistence Notice when running without external KV */}
      {runtimeInfo && !runtimeInfo.storagePersistent && (
        <div className="p-4 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E] space-y-1.5">
          <div className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Mode Vercel Serverless Sementara (Belum Ada Database Eksternal Terhubung)
            </span>
          </div>
          <p className="leading-relaxed">
            Aplikasi sudah aktif dan langsung bisa digunakan. Agar data suara &amp; foto tidak hilang saat server Vercel istirahat (*cold start*), hubungkan <strong>Upstash Redis / Vercel KV</strong> (<span className="font-mono">UPSTASH_REDIS_REST_URL</span> &amp; <span className="font-mono">UPSTASH_REDIS_REST_TOKEN</span>) di Vercel Environment Variables, lalu klik <strong>Sign in with Google</strong> untuk menyimpan file permanen di Google Drive. Jika domain Vercel baru diblokir saat Sign in with Google, tambahkan domain saat ini ke{' '}
            <a
              href="https://console.firebase.google.com/project/gen-lang-client-0705943683/authentication/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold"
            >
              Firebase Authorized Domains
            </a>
            .
          </p>
        </div>
      )}

      {/* Google Drive Archive & Auto-Sync Section */}
      <div className="bg-white border border-[#E3DED4] rounded-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-[#E3DED4] bg-[#F8F6F1] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#1B4332]">
              <Cloud className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Arsip Permanen Google Drive (Tanpa Login Google di Siswa)</span>
            </div>
            <h2 className="font-editorial text-xl font-semibold text-[#1A1917] mt-1">
              Folder Google Drive: &ldquo;{TARGET_FOLDER_NAME}&rdquo; (Otomatis Subfolder Per Kelas 71–95)
            </h2>
            <p className="text-xs text-[#5E5A52] mt-1">
              Siswa cukup mengupload karya dari password kelompoknya tanpa perlu login Google. Hubungkan akun guru (<span className="font-mono text-[#1A1917]">{TEACHER_EXPECTED_EMAIL}</span>) di sini agar seluruh data karya &amp; foto ukuran asli otomatis tersimpan ke Google Drive Anda dan tertata ke dalam subfolder <span className="font-mono">Kelas 71</span> s.d. <span className="font-mono">Kelas 95</span>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {!driveAccessToken ? (
              <button
                type="button"
                onClick={onGoogleDriveSignIn}
                className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#DADCE0] bg-white hover:bg-[#F8FAFC] text-[#1F1F1F] text-sm font-medium shadow-xs transition-colors whitespace-nowrap shrink-0"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>Sign in with Google</span>
              </button>
            ) : (
              <>
                <div className="text-right text-xs">
                  <div className="font-semibold text-[#1B4332]">
                    Terhubung: {driveUser?.email ?? driveConfig.driveOwnerEmail ?? 'Google Drive'}
                  </div>
                  <div className="text-[#5E5A52] tabular-nums">
                    {isSyncingDrive
                      ? 'Menyinkronkan ke Google Drive...'
                      : pendingDriveCount > 0
                        ? `${pendingDriveCount} foto siap disinkronkan`
                        : 'Semua foto sudah tersinkron'}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSyncingDrive}
                  onClick={() => setConfirmSyncOverwriteOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] disabled:opacity-50 text-white transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isSyncingDrive ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Sinkronkan Sekarang</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmOpenAccessModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-[#1B4332] bg-white hover:bg-[#F2F7F4] text-[#1B4332] transition-colors whitespace-nowrap shrink-0"
                >
                  <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Open Access</span>
                </button>

                <button
                  type="button"
                  onClick={onRefreshDriveFiles}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-[#E3DED4] bg-white hover:bg-[#F0EDE6] text-[#1A1917] transition-colors whitespace-nowrap shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Cek Folder</span>
                </button>

                <button
                  type="button"
                  onClick={onGoogleDriveSignOut}
                  className="px-3 py-2 text-xs font-medium rounded-lg border border-[#E3DED4] text-[#5E5A52] hover:text-[#1A1917] bg-white whitespace-nowrap shrink-0"
                >
                  Putus Akun
                </button>
              </>
            )}
          </div>
        </div>

        {/* Folder Link & Collected Drive Links Table */}
        <div className="p-6 space-y-5">
          {driveError && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] space-y-3"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <div className="font-semibold">
                    {driveActivationUrl
                      ? 'Google Drive API Belum Diaktifkan di Google Cloud Console'
                      : 'Sinkronisasi Google Drive Membutuhkan Perhatian'}
                  </div>
                  <p className="leading-relaxed">{driveError}</p>
                </div>
              </div>

              {driveActivationUrl && (
                <div className="pl-6 flex flex-wrap items-center gap-2.5">
                  <a
                    href={driveActivationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>1. Aktifkan Google Drive API</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    disabled={isSyncingDrive}
                    onClick={onRetryDriveSync}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#FECACA] bg-white hover:bg-[#FEF2F2] text-[#991B1B] font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isSyncingDrive ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>2. Coba Hubungkan &amp; Sinkronkan Ulang</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {isWrongDriveAccount && (
            <div className="p-4 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="font-semibold">
                    Akun Google saat ini ({driveUser?.email}) berbeda dengan akun guru yang diminta
                  </div>
                  <p>
                    Gunakan akun <span className="font-mono font-semibold">{TEACHER_EXPECTED_EMAIL}</span> agar file tersimpan langsung di Google Drive guru.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await onGoogleDriveSignOut();
                  await onGoogleDriveSignIn();
                }}
                className="px-3 py-1.5 rounded-lg bg-[#92400E] text-white font-semibold hover:bg-[#78350F] whitespace-nowrap shrink-0"
              >
                Ganti ke Akun Guru
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#F8F6F1] border border-[#E3DED4]">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#1A1917]">
                <span>Folder: {TARGET_FOLDER_NAME}</span>
                {driveConfig.driveOpenAccessStatus === 'anyone-writer' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#DCFCE7] text-[#166534] text-[11px] font-semibold">
                    <Globe className="w-3 h-3" aria-hidden="true" />
                    <span>Open Access (Anyone Can Upload &amp; View)</span>
                  </span>
                )}
                {driveConfig.driveOpenAccessStatus === 'anyone-reader' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#DBEAFE] text-[#1E40AF] text-[11px] font-semibold">
                    <Globe className="w-3 h-3" aria-hidden="true" />
                    <span>Open Access (Anyone Can View)</span>
                  </span>
                )}
                {driveConfig.driveOpenAccessStatus === 'restricted' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] text-[11px] font-semibold">
                    <span>Dibatasi Kebijakan Domain Sekolah</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-[#5E5A52]">
                {driveConfig.driveFolderUrl
                  ? `Tersimpan di Drive ${driveConfig.driveOwnerEmail ?? TEACHER_EXPECTED_EMAIL} · ${recapitulation.driveSyncedCount} karya ukuran asli tersinkron`
                  : `Klik "Sign in with Google" di atas dengan akun ${TEACHER_EXPECTED_EMAIL} untuk membuat folder "${TARGET_FOLDER_NAME}" dan mengaktifkan penyimpanan otomatis.`}
              </p>
            </div>

            {driveConfig.driveFolderUrl ? (
              <a
                href={driveConfig.driveFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Buka Folder Google Drive</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-xs text-[#8A8479] font-medium">
                Menunggu login Google Drive guru
              </span>
            )}
          </div>

          {/* Collected Artwork Drive Links Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#1A1917]">
                Daftar Link Google Drive Karya yang Terkumpul ({uploadedArtworks.length})
              </h3>
              <span className="text-xs text-[#5E5A52] font-mono tabular-nums">
                {recapitulation.driveSyncedCount} tersinkron di Drive
              </span>
            </div>

            {uploadedArtworks.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed border-[#D6CFC2] text-center text-xs text-[#5E5A52]">
                Belum ada kelompok yang mengupload foto karya. Link Google Drive untuk setiap kelompok akan muncul otomatis di sini.
              </div>
            ) : (
              <div className="overflow-x-auto border border-[#E3DED4] rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E3DED4] bg-[#FCFBF8] text-[#5E5A52]">
                      <th className="py-2.5 px-4 font-semibold">Kelompok</th>
                      <th className="py-2.5 px-4 font-semibold">Judul Karya &amp; Daun</th>
                      <th className="py-2.5 px-4 font-semibold">File Asli</th>
                      <th className="py-2.5 px-4 font-semibold">Status Drive</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Tautan Google Drive</th>
                    </tr>
                  </thead>
                    <tbody className="divide-y divide-[#ECE7DE]">
                    {uploadedArtworks.map((art) => (
                      <tr key={art.groupId} className="hover:bg-[#FAF8F4]">
                        <td className="py-3 px-4 font-mono font-semibold text-[#1A1917] tabular-nums whitespace-nowrap">
                          <div>{art.groupId} · Kls {art.className}</div>
                          {art.memberNames && (
                            <div className="font-sans text-[11px] font-medium text-[#1B4332] whitespace-normal max-w-[180px]">
                              {art.memberNames}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-[#1A1917]">{art.artworkTitle}</div>
                          <div className="text-[#5E5A52]">Daun: {art.leaves}</div>
                          <div className="text-[11px] font-mono text-[#8A8479]">
                            Subfolder: Kelas {art.className}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-[#5E5A52] tabular-nums">
                          <div>{art.originalFileName ?? `${art.groupId}.jpg`}</div>
                          <div className="text-[11px]">{formatBytes(art.originalFileSize)}</div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {art.driveWebViewLink ? (
                            <span className="inline-flex items-center gap-1 text-[#1B4332] font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Tersinkron</span>
                            </span>
                          ) : (
                            <span className="text-[#B45309] font-medium">
                              Menunggu Sinkron Drive
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            {art.photoUrl && (
                              <a
                                href={`/api/artworks/${encodeURIComponent(art.groupId)}/download-original`}
                                download={art.originalFileName ?? `${art.groupId}.jpg`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E3DED4] bg-white text-[#1A1917] hover:bg-[#F0EDE6] font-medium transition-colors"
                              >
                                <Download className="w-3 h-3" aria-hidden="true" />
                                <span>Unduh Asli</span>
                              </a>
                            )}
                            {art.driveWebViewLink ? (
                              <a
                                href={art.driveWebViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1B4332] text-[#1B4332] hover:bg-[#1B4332] hover:text-white font-semibold transition-colors"
                              >
                                <span>Buka di Drive</span>
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                              </a>
                            ) : (
                              <span className="text-[#8A8479]">Belum disinkronkan</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Live Drive Folder Files (fetched directly from Google Drive API) */}
          {driveFolderFiles.length > 0 && (
            <div className="pt-2">
              <h3 className="text-xs font-semibold text-[#5E5A52] mb-2">
                File Langsung dari Folder Google Drive ({driveFolderFiles.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {driveFolderFiles.map((file) => (
                  <a
                    key={file.id}
                    href={file.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-lg border border-[#E3DED4] bg-[#F8F6F1] hover:border-[#1B4332] flex items-center justify-between gap-2 text-xs transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#1A1917] truncate">{file.name}</div>
                      <div className="text-[11px] font-mono text-[#5E5A52] tabular-nums">
                        {file.className ? `Kelas ${file.className} · ` : 'Folder Utama · '}
                        {formatBytes(file.size)}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-[#1B4332] shrink-0" aria-hidden="true" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Admin Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E3DED4] rounded-xl p-5">
          <div className="text-xs text-[#5E5A52]">Total Kelompok Terdaftar</div>
          <div className="font-mono text-2xl font-semibold text-[#1A1917] tabular-nums mt-1">
            {recapitulation.totalGroups} Kelompok
          </div>
          <p className="text-xs text-[#5E5A52] mt-1">13 kelas · 4 kelompok per kelas</p>
        </div>

        <div className="bg-white border border-[#E3DED4] rounded-xl p-5">
          <div className="text-xs text-[#5E5A52]">Progres Upload Foto Karya</div>
          <div className="font-mono text-2xl font-semibold text-[#1A1917] tabular-nums mt-1">
            {recapitulation.uploadedPhotosCount} / {recapitulation.totalGroups}
          </div>
          <p className="text-xs text-[#5E5A52] mt-1">
            {recapitulation.driveSyncedCount} sudah tersinkron ke Google Drive
          </p>
        </div>

        <div className="bg-white border border-[#E3DED4] rounded-xl p-5">
          <div className="text-xs text-[#5E5A52]">Penilaian Terkunci Masuk</div>
          <div className="font-mono text-2xl font-semibold text-[#1B4332] tabular-nums mt-1">
            {recapitulation.submittedGroupsCount} / {recapitulation.totalGroups}
          </div>
          <p className="text-xs text-[#5E5A52] mt-1">
            {recapitulation.totalPointsDistributed} total poin lintas jenjang
          </p>
        </div>
      </div>

      {/* Monitoring Grid per Class */}
      <div className="bg-white border border-[#E3DED4] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E3DED4] bg-[#F8F6F1] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-editorial text-xl font-semibold text-[#1A1917]">
              Status Kelompok per Kelas (71–95)
            </h2>
            <p className="text-xs text-[#5E5A52]">
              Guru dapat memantau foto karya, link Drive, serta membuka kunci penilaian kelompok tertentu jika diperlukan.
            </p>
          </div>
        </div>

        <div className="divide-y divide-[#ECE7DE]">
          {ALL_CLASSES.map((cls) => {
            const groups = catalog.filter((g) => g.className === cls.className);
            return (
              <div key={cls.className} className="px-6 py-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-sm text-[#1A1917]">
                    Kelas {cls.className} · Jenjang {cls.grade}
                  </span>
                  <span className="text-[#5E5A52] font-mono tabular-nums">
                    {groups.filter((g) => lockedIds.has(g.groupId)).length}/4 suara ·{' '}
                    {groups.filter((g) => Boolean(g.photoUrl || g.driveWebViewLink)).length}/4 foto
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {groups.map((group) => {
                    const isLocked = lockedIds.has(group.groupId);
                    return (
                      <div
                        key={group.groupId}
                        className="p-3 rounded-lg border border-[#E3DED4] bg-[#FAF9F6] flex flex-col justify-between gap-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-semibold text-[#1A1917] tabular-nums">
                            {group.groupId}
                          </span>
                          {isLocked ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1B4332]">
                              <Lock className="w-3 h-3" aria-hidden="true" />
                              <span>Terkunci</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-[#8A8479]">Belum menilai</span>
                          )}
                        </div>

                        <div className="text-xs text-[#5E5A52] flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5">
                            <CheckCircle2
                              className={`w-3.5 h-3.5 shrink-0 ${
                                group.photoUrl || group.driveWebViewLink
                                  ? 'text-[#1B4332]'
                                  : 'text-[#C9C1B2]'
                              }`}
                              aria-hidden="true"
                            />
                            <span>
                              {group.driveWebViewLink
                                ? 'Di Drive'
                                : group.photoUrl
                                  ? 'Foto diupload'
                                  : 'Belum ada foto'}
                            </span>
                          </span>

                          {group.driveWebViewLink && (
                            <a
                              href={group.driveWebViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-semibold text-[#1B4332] hover:underline inline-flex items-center gap-0.5"
                            >
                              <span>Link</span>
                              <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </a>
                          )}
                        </div>

                        {isLocked && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onUnlockGroup(group.groupId)}
                            className="mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border border-[#E3DED4] bg-white hover:bg-[#FEF2F2] hover:border-[#FECACA] text-[11px] font-medium text-[#991B1B] transition-colors"
                          >
                            <Unlock className="w-3 h-3" aria-hidden="true" />
                            <span>Buka Kunci Penilaian</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirm Manual Sync / Manifest Update in Google Drive */}
      {confirmSyncOverwriteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-sync-drive-title"
        >
          <div className="bg-white border border-[#E3DED4] rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-2.5 text-[#1B4332]">
              <Cloud className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h3
                id="confirm-sync-drive-title"
                className="font-editorial text-lg font-semibold text-[#1A1917]"
              >
                Sinkronkan Foto &amp; Arsip ke Google Drive?
              </h3>
            </div>
            <p className="text-sm text-[#5E5A52] mt-2 leading-relaxed">
              Aplikasi akan mengunggah {pendingDriveCount} foto karya ukuran asli (tanpa kompresi) ke subfolder per kelas (<strong className="text-[#1A1917]">Kelas 71–95</strong>) di dalam folder <strong className="text-[#1A1917]">{TARGET_FOLDER_NAME}</strong> pada Google Drive Anda dan memperbarui file rekap CSV &amp; manifest.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmSyncOverwriteOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-[#E3DED4] text-[#1A1917] hover:bg-[#F8F6F1]"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSyncingDrive}
                onClick={async () => {
                  setConfirmSyncOverwriteOpen(false);
                  await onSyncAllToDrive();
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white"
              >
                Ya, Sinkronkan ke Drive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Open Access Permission Modal */}
      {confirmOpenAccessModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-open-access-title"
        >
          <div className="bg-white border border-[#E3DED4] rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-2.5 text-[#1B4332]">
              <Globe className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h3
                id="confirm-open-access-title"
                className="font-editorial text-lg font-semibold text-[#1A1917]"
              >
                Aktifkan Open Access Folder Drive?
              </h3>
            </div>
            <p className="text-sm text-[#5E5A52] mt-2 leading-relaxed">
              Folder <strong className="text-[#1A1917]">{TARGET_FOLDER_NAME}</strong> akan diatur agar terbuka bagi siapa saja yang memiliki tautan (<em>Anyone with the link can edit/upload</em>) sehingga seluruh file karya ukuran asli dapat tersimpan dan diakses langsung.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpenAccessModal(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-[#E3DED4] text-[#1A1917] hover:bg-[#F8F6F1]"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSyncingDrive}
                onClick={async () => {
                  setConfirmOpenAccessModal(false);
                  await onConfigureOpenAccess();
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white"
              >
                Ya, Aktifkan Open Access
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Reset Modal */}
      {confirmResetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-confirm-reset-title"
        >
          <div className="bg-white border border-[#E3DED4] rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-2.5 text-[#991B1B]">
              <RefreshCw className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h3
                id="admin-confirm-reset-title"
                className="font-editorial text-lg font-semibold text-[#1A1917]"
              >
                Reset Seluruh Data Penilaian?
              </h3>
            </div>
            <p className="text-sm text-[#5E5A52] mt-2 leading-relaxed">
              Semua {submissions.length} suara yang masuk akan dihapus dan seluruh kelompok dibuka kembali untuk memulai sesi penilaian baru. Foto karya &amp; tautan Google Drive tetap tersimpan aman.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmResetOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-[#E3DED4] text-[#1A1917] hover:bg-[#F8F6F1]"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={async () => {
                  await onResetAll();
                  setConfirmResetOpen(false);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#991B1B] hover:bg-[#7F1D1D] text-white"
              >
                Ya, Reset Semua
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
