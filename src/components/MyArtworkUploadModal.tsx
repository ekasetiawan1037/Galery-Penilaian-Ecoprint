import React, { useEffect, useState } from 'react';
import { AlertTriangle, Cloud, Download, ImagePlus, Trash2, Upload, X } from 'lucide-react';
import { getCachedDriveToken } from '../lib/googleDriveAuth';
import type { ArtworkGroup, DriveArchiveConfig } from '../shared/ecoprint';

interface MyArtworkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: ArtworkGroup | null;
  authToken: string | null;
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

export const MyArtworkUploadModal: React.FC<MyArtworkUploadModalProps> = ({
  isOpen,
  onClose,
  group,
  authToken,
  onUpdated,
  onSuccessToast,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [memberNames, setMemberNames] = useState('');
  const [artworkTitle, setArtworkTitle] = useState('');
  const [leaves, setLeaves] = useState('');
  const [technique, setTechnique] = useState('');
  const [fabric, setFabric] = useState('');
  const [mordant, setMordant] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (isOpen && group) {
      setSelectedFile(null);
      setPreviewDataUrl(null);
      setMemberNames(group.memberNames || '');
      setArtworkTitle(group.artworkTitle);
      setLeaves(group.leaves);
      setTechnique(group.technique);
      setFabric(group.fabric);
      setMordant(group.mordant);
      setDescription(group.description);
      setError(null);
      setConfirmDeleteOpen(false);
    }
  }, [isOpen, group]);

  if (!isOpen || !group || !authToken) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (file.size > 25 * 1024 * 1024) {
      setError('Ukuran file melebihi batas maksimal 25 MB.');
      return;
    }

    try {
      const originalDataUrl = await readOriginalFileAsDataUrl(file);
      setSelectedFile(file);
      setPreviewDataUrl(originalDataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membaca file asli.');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artworkTitle.trim() || !leaves.trim()) {
      setError('Judul karya dan daun yang digunakan wajib diisi.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/artworks/${encodeURIComponent(group.groupId)}/photo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          ...(previewDataUrl && selectedFile
            ? {
                imageDataUrl: previewDataUrl,
                originalFileName: selectedFile.name,
                originalMimeType: selectedFile.type || 'image/jpeg',
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
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error ?? 'Gagal menyimpan perubahan karya.');
        return;
      }
      onUpdated(payload.state);
      onSuccessToast(
        selectedFile
          ? `Nama, judul, daun & foto asli (${formatBytes(selectedFile.size)}) Kelompok ${group.groupId} tersimpan dan siap masuk folder Kelas ${group.className} di Google Drive.`
          : `Data nama anggota, judul karya & daun Kelompok ${group.groupId} berhasil diperbarui.`,
      );
      onClose();
    } catch {
      setError('Gagal menghubungi server saat menyimpan karya.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDeletePhoto = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const driveToken = getCachedDriveToken();
      const res = await fetch(`/api/artworks/${encodeURIComponent(group.groupId)}/photo`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
          ...(driveToken ? { 'X-Drive-Token': driveToken } : {}),
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.error ?? 'Gagal menghapus foto.');
        return;
      }
      setSelectedFile(null);
      setPreviewDataUrl(null);
      setConfirmDeleteOpen(false);
      onUpdated(payload.state);
      onSuccessToast(`Foto karya Kelompok ${group.groupId} berhasil dihapus.`);
    } catch {
      setError('Gagal menghubungi server.');
    } finally {
      setIsSaving(false);
    }
  };

  const displayedPhoto =
    previewDataUrl ??
    group.photoUrl ??
    (group.driveFileId
      ? `https://drive.google.com/thumbnail?id=${group.driveFileId}&sz=w1000`
      : null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-artwork-title"
    >
      <div className="bg-white border border-[#E3DED4] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-6 py-5 border-b border-[#E3DED4] flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-mono font-semibold text-[#1B4332]">
              Kelompok {group.groupId} · Kelas {group.className}
            </div>
            <h2
              id="upload-artwork-title"
              className="font-editorial text-xl font-semibold text-[#1A1917] mt-0.5"
            >
              Edit Nama, Judul, Daun &amp; Upload Foto Asli
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog edit karya"
            className="p-2 rounded-lg text-[#5E5A52] hover:text-[#1A1917] hover:bg-[#F0EDE6] transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5">
          {/* Primary Editable Fields: Nama Anggota/Kelompok, Judul Karya & Daun yang Digunakan */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F8F6F1] border border-[#E3DED4] rounded-xl p-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="edit-member-names"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Nama Kelompok / Nama Anggota Siswa
              </label>
              <input
                id="edit-member-names"
                type="text"
                value={memberNames}
                onChange={(e) => setMemberNames(e.target.value)}
                placeholder="Contoh: Tim Melati — Budi, Siti, Rina, Ahmad"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="edit-artwork-title"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Judul Karya Ecoprint
              </label>
              <input
                id="edit-artwork-title"
                type="text"
                required
                value={artworkTitle}
                onChange={(e) => setArtworkTitle(e.target.value)}
                placeholder="Tulis judul karya kelompok Anda..."
                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="edit-artwork-leaves"
                className="block text-xs font-semibold text-[#1A1917] mb-1"
              >
                Daun yang Digunakan
              </label>
              <input
                id="edit-artwork-leaves"
                type="text"
                required
                value={leaves}
                onChange={(e) => setLeaves(e.target.value)}
                placeholder="Contoh: Daun Jati, Kenikir, Eucalyptus, Pakis"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED4] rounded-lg"
              />
            </div>
          </div>

          {/* Original-Size Image Upload */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
            <div className="sm:col-span-6 aspect-[4/3] rounded-xl border border-[#E3DED4] bg-[#F0EDE6] overflow-hidden flex items-center justify-center">
              {displayedPhoto ? (
                <img
                  src={displayedPhoto}
                  alt={`Preview karya ${group.groupId}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center p-4">
                  <ImagePlus className="w-8 h-8 text-[#8A8479] mx-auto mb-2" aria-hidden="true" />
                  <p className="text-xs text-[#5E5A52]">Belum ada foto karya</p>
                </div>
              )}
            </div>

            <div className="sm:col-span-6 space-y-3">
              <label className="block">
                <span className="sr-only">Pilih file foto ukuran asli</span>
                <div className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white text-sm font-semibold cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  <span>{displayedPhoto ? 'Ganti Foto (Ukuran Asli)' : 'Pilih Foto (Ukuran Asli)'}</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              <div className="text-xs text-[#5E5A52] leading-relaxed space-y-1">
                <p>
                  Foto disimpan dalam <strong>ukuran &amp; resolusi asli tanpa dikompresi</strong> (maks. 25 MB) dan otomatis diarsipkan ke Google Drive guru pada folder <strong>galery penilaian Ecoprint / Kelas {group.className}</strong>.
                </p>
                {selectedFile ? (
                  <p className="font-mono text-[11px] text-[#1B4332] tabular-nums">
                    File dipilih: {selectedFile.name} ({formatBytes(selectedFile.size)})
                  </p>
                ) : group.originalFileName ? (
                  <p className="font-mono text-[11px] text-[#1A1917] tabular-nums">
                    Tersimpan: {group.originalFileName} ({formatBytes(group.originalFileSize)})
                  </p>
                ) : null}

                {group.originalFileName && !selectedFile && (
                  <a
                    href={`/api/artworks/${encodeURIComponent(group.groupId)}/download-original`}
                    download={group.originalFileName}
                    className="inline-flex items-center gap-1 text-[11px] text-[#1B4332] font-semibold hover:underline mr-3"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Unduh File Asli</span>
                  </a>
                )}

                {group.driveWebViewLink && !selectedFile && (
                  <p className="inline-flex items-center gap-1 text-[11px] text-[#1B4332] font-medium">
                    <Cloud className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Tersinkron di Google Drive</span>
                  </p>
                )}
              </div>

              {(group.photoUrl || group.driveFileId) && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#991B1B] hover:underline"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Hapus foto saat ini</span>
                </button>
              )}
            </div>
          </div>

          {confirmDeleteOpen && (
            <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] space-y-2 text-xs">
              <div className="flex items-start gap-2 text-[#991B1B] font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Hapus foto karya Kelompok {group.groupId}?{group.driveFileId ? ' File yang tersinkron di Google Drive juga akan dihapus jika sesi Drive aktif.' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
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

          {/* Additional Botanical Specs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-[#ECE7DE]">
            <div>
              <label className="block text-xs font-semibold text-[#1A1917] mb-1">
                Teknik
              </label>
              <input
                type="text"
                value={technique}
                onChange={(e) => setTechnique(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1917] mb-1">
                Media Kain
              </label>
              <input
                type="text"
                value={fabric}
                onChange={(e) => setFabric(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1917] mb-1">
                Mordant / Fiksasi
              </label>
              <input
                type="text"
                value={mordant}
                onChange={(e) => setMordant(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold text-[#1A1917] mb-1">
                Deskripsi Singkat Karya
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg"
              />
            </div>
          </div>

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
              {isSaving ? 'Menyimpan...' : 'Simpan Perubahan Karya'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
