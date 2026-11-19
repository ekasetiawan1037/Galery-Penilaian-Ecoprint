import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  Download,
  ImagePlus,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { getCachedDriveToken } from '../lib/googleDriveAuth';
import type { ArtworkGroup, DriveArchiveConfig, PhotoKind } from '../shared/ecoprint';

interface AdminEditGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: ArtworkGroup | null;
  adminToken: string | null;
  onUpdated: (payload: {
    catalog: ArtworkGroup[];
    submissions: unknown[];
    recapitulation: unknown;
    driveConfig: DriveArchiveConfig;
    updatedAt: string;
  }) => void;
  onSuccessToast: (msg: string) => void;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function readOriginalFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar asli.'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer]);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal mengonversi potongan file asli.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIdx = dataUrl.indexOf(',');
      resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.readAsDataURL(blob);
  });
}

const CHUNK_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
const CHUNK_RAW_BYTES = 1500 * 1024;

export const AdminEditGroupModal: React.FC<AdminEditGroupModalProps> = ({
  isOpen,
  onClose,
  group,
  adminToken,
  onUpdated,
  onSuccessToast,
}) => {
  const [selectedArtworkFile, setSelectedArtworkFile] = useState<File | null>(null);
  const [artworkPreviewUrl, setArtworkPreviewUrl] = useState<string | null>(null);

  const [selectedGroupFile, setSelectedGroupFile] = useState<File | null>(null);
  const [groupPreviewUrl, setGroupPreviewUrl] = useState<string | null>(null);

  const [memberNames, setMemberNames] = useState('');
  const [artworkTitle, setArtworkTitle] = useState('');
  const [leaves, setLeaves] = useState('');
  const [technique, setTechnique] = useState('');
  const [fabric, setFabric] = useState('');
  const [mordant, setMordant] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteKind, setConfirmDeleteKind] = useState<PhotoKind | null>(null);
  const initializedForGroupRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      initializedForGroupRef.current = null;
      return;
    }
    if (group && initializedForGroupRef.current !== group.groupId) {
      initializedForGroupRef.current = group.groupId;
      setSelectedArtworkFile(null);
      setArtworkPreviewUrl(null);
      setSelectedGroupFile(null);
      setGroupPreviewUrl(null);
      setMemberNames(group.memberNames || '');
      setArtworkTitle(group.artworkTitle);
      setLeaves(group.leaves);
      setTechnique(group.technique);
      setFabric(group.fabric);
      setMordant(group.mordant);
      setDescription(group.description);
      setUploadProgress(null);
      setError(null);
      setConfirmDeleteKind(null);
    }
  }, [isOpen, group]);

  if (!isOpen || !group || !adminToken) return null;

  const handleFileChange = async (
    kind: PhotoKind,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (file.size > 25 * 1024 * 1024) {
      setError('Ukuran file melebihi batas maksimal 25 MB per foto.');
      return;
    }

    try {
      const originalDataUrl = await readOriginalFileAsDataUrl(file);
      if (kind === 'artwork') {
        setSelectedArtworkFile(file);
        setArtworkPreviewUrl(originalDataUrl);
      } else {
        setSelectedGroupFile(file);
        setGroupPreviewUrl(originalDataUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membaca file asli.');
    }
  };

  const uploadChunksForFile = async (
    file: File,
    kind: PhotoKind,
    label: string,
  ): Promise<{ uploadId: string; totalChunks: number }> => {
    const uploadId = `adm_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.ceil(file.size / CHUNK_RAW_BYTES);
    for (let i = 0; i < totalChunks; i++) {
      setUploadProgress(`Mengunggah ${label} (${i + 1}/${totalChunks})...`);
      const start = i * CHUNK_RAW_BYTES;
      const end = Math.min(file.size, start + CHUNK_RAW_BYTES);
      const sliceBuffer = await file.slice(start, end).arrayBuffer();
      const chunkBase64 = await arrayBufferToBase64(sliceBuffer);
      const chunkRes = await fetch(
        `/api/artworks/${encodeURIComponent(group.groupId)}/photo-chunk`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            uploadId,
            chunkIndex: i,
            totalChunks,
            chunkBase64,
            kind,
          }),
        },
      );
      if (!chunkRes.ok) {
        const errBody = await chunkRes.json().catch(() => ({}));
        throw new Error(
          errBody.error ?? `Gagal mengunggah potongan ${label} ukuran asli.`,
        );
      }
    }
    return { uploadId, totalChunks };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artworkTitle.trim() || !leaves.trim()) {
      setError('Judul karya dan daun yang digunakan wajib diisi.');
      return;
    }

    setIsSaving(true);
    setUploadProgress(null);
    setError(null);

    try {
      let artworkChunkPayload: { uploadId: string; totalChunks: number } | null = null;
      let groupChunkPayload: { uploadId: string; totalChunks: number } | null = null;

      if (selectedArtworkFile && selectedArtworkFile.size > CHUNK_THRESHOLD_BYTES) {
        artworkChunkPayload = await uploadChunksForFile(
          selectedArtworkFile,
          'artwork',
          'Foto Karya',
        );
      }

      if (selectedGroupFile && selectedGroupFile.size > CHUNK_THRESHOLD_BYTES) {
        groupChunkPayload = await uploadChunksForFile(
          selectedGroupFile,
          'group',
          'Foto Kelompok',
        );
      }

      if (selectedArtworkFile || selectedGroupFile) {
        setUploadProgress('Menulis perubahan & foto asli ke Google Drive...');
      }

      const driveToken = getCachedDriveToken();

      const res = await fetch(
        `/api/admin/artworks/${encodeURIComponent(group.groupId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
            ...(driveToken ? { 'X-Drive-Token': driveToken } : {}),
          },
          body: JSON.stringify({
            ...(artworkChunkPayload
              ? {
                  uploadId: artworkChunkPayload.uploadId,
                  totalChunks: artworkChunkPayload.totalChunks,
                  originalFileName: selectedArtworkFile!.name,
                  originalMimeType: selectedArtworkFile!.type || 'image/jpeg',
                }
              : artworkPreviewUrl && selectedArtworkFile
                ? {
                    imageDataUrl: artworkPreviewUrl,
                    originalFileName: selectedArtworkFile.name,
                    originalMimeType: selectedArtworkFile.type || 'image/jpeg',
                  }
                : {}),
            ...(groupChunkPayload
              ? {
                  groupUploadId: groupChunkPayload.uploadId,
                  groupTotalChunks: groupChunkPayload.totalChunks,
                  groupOriginalFileName: selectedGroupFile!.name,
                  groupOriginalMimeType: selectedGroupFile!.type || 'image/jpeg',
                }
              : groupPreviewUrl && selectedGroupFile
                ? {
                    groupImageDataUrl: groupPreviewUrl,
                    groupOriginalFileName: selectedGroupFile.name,
                    groupOriginalMimeType: selectedGroupFile.type || 'image/jpeg',
                  }
                : {}),
            memberNames: memberNames.trim(),
            artworkTitle: artworkTitle.trim(),
            leaves: leaves.trim(),
            technique: technique.trim(),
            fabric: fabric.trim(),
            mordant: mordant.trim(),
            description: description.trim(),
          }),
        },
      );

      const rawText = await res.text();
      let payload: any = null;
      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = null;
      }

      if (!res.ok) {
        setError(
          payload?.error ??
            `Gagal menyimpan perubahan Admin untuk Kelompok ${group.groupId} (HTTP ${res.status}).`,
        );
        return;
      }

      if (!payload?.state) {
        setError('Respons server tidak lengkap. Silakan coba simpan ulang.');
        return;
      }

      onUpdated(payload.state);
      onSuccessToast(
        payload.driveSyncStatus === 'synced'
          ? `Perubahan Kelompok ${group.groupId} berhasil disimpan & otomatis tersinkron ke Google Drive.`
          : `Perubahan nama, deskripsi & foto Kelompok ${group.groupId} berhasil disimpan oleh Admin.`,
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal menghubungi server saat menyimpan perubahan Admin.',
      );
    } finally {
      setIsSaving(false);
      setUploadProgress(null);
    }
  };

  const handleConfirmDeletePhoto = async () => {
    if (!confirmDeleteKind) return;
    setIsSaving(true);
    setError(null);
    try {
      const driveToken = getCachedDriveToken();
      const res = await fetch(
        `/api/admin/artworks/${encodeURIComponent(group.groupId)}/photo?kind=${confirmDeleteKind}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            ...(driveToken ? { 'X-Drive-Token': driveToken } : {}),
          },
        },
      );
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error ?? 'Gagal menghapus foto.');
        return;
      }
      if (confirmDeleteKind === 'artwork') {
        setSelectedArtworkFile(null);
        setArtworkPreviewUrl(null);
      } else {
        setSelectedGroupFile(null);
        setGroupPreviewUrl(null);
      }
      const deletedLabel =
        confirmDeleteKind === 'artwork' ? 'Foto karya' : 'Foto kelompok bersama karya';
      setConfirmDeleteKind(null);
      onUpdated(payload.state);
      onSuccessToast(`${deletedLabel} Kelompok ${group.groupId} berhasil dihapus oleh Admin.`);
    } catch {
      setError('Gagal menghubungi server.');
    } finally {
      setIsSaving(false);
    }
  };

  const displayedArtworkPhoto =
    artworkPreviewUrl ??
    (group.driveFileId
      ? `https://drive.google.com/thumbnail?id=${group.driveFileId}&sz=w1000`
      : null) ??
    group.photoUrl;

  const displayedGroupPhoto =
    groupPreviewUrl ??
    (group.groupDriveFileId
      ? `https://drive.google.com/thumbnail?id=${group.groupDriveFileId}&sz=w1000`
      : null) ??
    group.groupPhotoUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-edit-group-title"
    >
      <div className="bg-white border border-[#E3DED4] rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-6 py-5 border-b border-[#E3DED4] bg-[#F8F6F1] flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-[#1B4332]">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Edit Admin Guru · Kelompok {group.groupId} · Kelas {group.className}</span>
            </div>
            <h2
              id="admin-edit-group-title"
              className="font-editorial text-xl font-semibold text-[#1A1917] mt-0.5"
            >
              Ubah Nama Kelompok, Deskripsi, Data Karya &amp; Foto
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog edit admin"
            className="p-2 rounded-lg text-[#5E5A52] hover:text-[#1A1917] hover:bg-[#EFECE5] transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F8F6F1] border border-[#E3DED4] rounded-xl p-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="admin-edit-member-names"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Nama Kelompok / Daftar Nama Anggota Siswa
              </label>
              <input
                id="admin-edit-member-names"
                type="text"
                value={memberNames}
                onChange={(e) => setMemberNames(e.target.value)}
                placeholder="Contoh: Tim Melati — Budi, Siti, Rina, Ahmad"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="admin-edit-artwork-title"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Judul Karya Ecoprint
              </label>
              <input
                id="admin-edit-artwork-title"
                type="text"
                required
                value={artworkTitle}
                onChange={(e) => setArtworkTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="admin-edit-artwork-leaves"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Daun yang Digunakan
              </label>
              <input
                id="admin-edit-artwork-leaves"
                type="text"
                required
                value={leaves}
                onChange={(e) => setLeaves(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED4] rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="admin-edit-technique"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Teknik
              </label>
              <input
                id="admin-edit-technique"
                type="text"
                value={technique}
                onChange={(e) => setTechnique(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="admin-edit-fabric"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Media Kain
              </label>
              <input
                id="admin-edit-fabric"
                type="text"
                value={fabric}
                onChange={(e) => setFabric(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="admin-edit-mordant"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Mordant / Fiksasi
              </label>
              <input
                id="admin-edit-mordant"
                type="text"
                value={mordant}
                onChange={(e) => setMordant(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="admin-edit-description"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Deskripsi Karya
              </label>
              <textarea
                id="admin-edit-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg"
              />
            </div>
          </div>

          {/* 2 Photo Slots */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="p-4 rounded-xl border border-[#E3DED4] bg-white space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#1A1917]">
                    1. Foto Karya Ecoprint
                  </h3>
                  <p className="text-xs text-[#5E5A52]">
                    Tampil pada grid Dashboard &amp; halaman Detail.
                  </p>
                </div>

                <div className="aspect-[4/3] rounded-lg border border-[#E3DED4] bg-[#F0EDE6] overflow-hidden flex items-center justify-center">
                  {displayedArtworkPhoto ? (
                    <img
                      src={displayedArtworkPhoto}
                      alt={`Preview foto karya ${group.groupId}`}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        if (
                          !artworkPreviewUrl &&
                          group.photoUrl &&
                          e.currentTarget.src !== window.location.origin + group.photoUrl
                        ) {
                          e.currentTarget.src = group.photoUrl;
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-4">
                      <ImagePlus
                        className="w-7 h-7 text-[#8A8479] mx-auto mb-1.5"
                        aria-hidden="true"
                      />
                      <p className="text-xs text-[#5E5A52]">Belum ada foto karya</p>
                    </div>
                  )}
                </div>

                <label className="block">
                  <span className="sr-only">Pilih atau ganti foto karya</span>
                  <div className="inline-flex items-center justify-center gap-2 w-full px-3.5 py-2 rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white text-xs font-semibold cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {displayedArtworkPhoto
                        ? 'Ganti Foto Karya (Asli)'
                        : 'Upload Foto Karya (Asli)'}
                    </span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileChange('artwork', e)}
                    className="hidden"
                  />
                </label>

                <div className="text-[11px] text-[#5E5A52] space-y-1">
                  {selectedArtworkFile ? (
                    <p className="font-mono text-[#1B4332] tabular-nums truncate">
                      Dipilih: {selectedArtworkFile.name} ({formatBytes(selectedArtworkFile.size)})
                    </p>
                  ) : group.originalFileName ? (
                    <p className="font-mono text-[#1A1917] tabular-nums truncate">
                      File: {group.originalFileName} ({formatBytes(group.originalFileSize)})
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-3">
                    {group.originalFileName && !selectedArtworkFile && (
                      <a
                        href={`/api/artworks/${encodeURIComponent(group.groupId)}/download-original?kind=artwork`}
                        download={group.originalFileName}
                        className="inline-flex items-center gap-1 text-[#1B4332] font-semibold hover:underline"
                      >
                        <Download className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>Unduh Asli</span>
                      </a>
                    )}
                    {group.driveWebViewLink && !selectedArtworkFile && (
                      <a
                        href={group.driveWebViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#1B4332] font-medium hover:underline"
                      >
                        <Cloud className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>Buka di Drive</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {(group.photoUrl || group.driveFileId) && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setConfirmDeleteKind('artwork')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#991B1B] hover:underline w-fit"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Hapus Foto Karya</span>
                </button>
              )}
            </div>

            <div className="p-4 rounded-xl border border-[#E3DED4] bg-white space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#1A1917] flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-[#1B4332]" aria-hidden="true" />
                    <span>2. Foto Kelompok Bersama Karya</span>
                  </h3>
                  <p className="text-xs text-[#5E5A52]">
                    Tampil saat tombol <strong>Detail</strong> dibuka.
                  </p>
                </div>

                <div className="aspect-[4/3] rounded-lg border border-[#E3DED4] bg-[#F0EDE6] overflow-hidden flex items-center justify-center">
                  {displayedGroupPhoto ? (
                    <img
                      src={displayedGroupPhoto}
                      alt={`Preview foto kelompok ${group.groupId}`}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        if (
                          !groupPreviewUrl &&
                          group.groupPhotoUrl &&
                          e.currentTarget.src !== window.location.origin + group.groupPhotoUrl
                        ) {
                          e.currentTarget.src = group.groupPhotoUrl;
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-4">
                      <Users
                        className="w-7 h-7 text-[#8A8479] mx-auto mb-1.5"
                        aria-hidden="true"
                      />
                      <p className="text-xs text-[#5E5A52]">
                        Belum ada foto kelompok bersama karya
                      </p>
                    </div>
                  )}
                </div>

                <label className="block">
                  <span className="sr-only">Pilih atau ganti foto kelompok</span>
                  <div className="inline-flex items-center justify-center gap-2 w-full px-3.5 py-2 rounded-lg border border-[#1B4332] bg-[#F2F7F4] hover:bg-[#1B4332] text-[#1B4332] hover:text-white text-xs font-semibold cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {displayedGroupPhoto
                        ? 'Ganti Foto Kelompok (Asli)'
                        : 'Upload Foto Kelompok (Asli)'}
                    </span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileChange('group', e)}
                    className="hidden"
                  />
                </label>

                <div className="text-[11px] text-[#5E5A52] space-y-1">
                  {selectedGroupFile ? (
                    <p className="font-mono text-[#1B4332] tabular-nums truncate">
                      Dipilih: {selectedGroupFile.name} ({formatBytes(selectedGroupFile.size)})
                    </p>
                  ) : group.groupOriginalFileName ? (
                    <p className="font-mono text-[#1A1917] tabular-nums truncate">
                      File: {group.groupOriginalFileName} ({formatBytes(group.groupOriginalFileSize)})
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-3">
                    {group.groupOriginalFileName && !selectedGroupFile && (
                      <a
                        href={`/api/artworks/${encodeURIComponent(group.groupId)}/download-original?kind=group`}
                        download={group.groupOriginalFileName}
                        className="inline-flex items-center gap-1 text-[#1B4332] font-semibold hover:underline"
                      >
                        <Download className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>Unduh Asli</span>
                      </a>
                    )}
                    {group.groupDriveWebViewLink && !selectedGroupFile && (
                      <a
                        href={group.groupDriveWebViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#1B4332] font-medium hover:underline"
                      >
                        <Cloud className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>Buka di Drive</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {(group.groupPhotoUrl || group.groupDriveFileId) && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setConfirmDeleteKind('group')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#991B1B] hover:underline w-fit"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Hapus Foto Kelompok</span>
                </button>
              )}
            </div>
          </div>

          {confirmDeleteKind && (
            <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] space-y-2 text-xs">
              <div className="flex items-start gap-2 text-[#991B1B] font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Hapus {confirmDeleteKind === 'artwork' ? 'Foto Karya' : 'Foto Kelompok Bersama Karya'} Kelompok {group.groupId}?
                </span>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteKind(null)}
                  className="px-3 py-1 rounded border border-[#E3DED4] bg-white text-[#1A1917]"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleConfirmDeletePhoto}
                  className="px-3 py-1 rounded bg-[#991B1B] text-white font-semibold"
                >
                  Ya, Hapus Foto
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs font-medium text-[#991B1B]" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-[#E3DED4] text-[#1A1917] hover:bg-[#F8F6F1]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] disabled:opacity-50 text-white"
            >
              {isSaving ? (uploadProgress ?? 'Menyimpan...') : 'Simpan Perubahan Admin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
