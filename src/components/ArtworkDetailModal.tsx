import React, { useState } from 'react';
import {
  Download,
  ExternalLink,
  ImageOff,
  KeyRound,
  Lock,
  Pencil,
  Star,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  RANK_CONFIG,
  canAssessArtwork,
  type ArtworkGroup,
  type RankNumber,
} from '../shared/ecoprint';

interface ArtworkDetailModalProps {
  artwork: ArtworkGroup | null;
  evaluatorGroup: ArtworkGroup | null;
  isEvaluatorLocked: boolean;
  assignedRank?: RankNumber;
  onAssignRank: (artworkGroupId: string, rank: RankNumber) => void;
  onClearRank: (artworkGroupId: string) => void;
  onOpenUploadMyPhoto: () => void;
  onOpenLogin: () => void;
  onClose: () => void;
}

export const ArtworkDetailModal: React.FC<ArtworkDetailModalProps> = ({
  artwork,
  evaluatorGroup,
  isEvaluatorLocked,
  assignedRank,
  onAssignRank,
  onClearRank,
  onOpenUploadMyPhoto,
  onOpenLogin,
  onClose,
}) => {
  const [localFailed, setLocalFailed] = useState(false);
  const [driveFailed, setDriveFailed] = useState(false);
  const [groupLocalFailed, setGroupLocalFailed] = useState(false);
  const [groupDriveFailed, setGroupDriveFailed] = useState(false);

  React.useEffect(() => {
    setLocalFailed(false);
    setDriveFailed(false);
    setGroupLocalFailed(false);
    setGroupDriveFailed(false);
  }, [
    artwork?.groupId,
    artwork?.photoUrl,
    artwork?.driveFileId,
    artwork?.groupPhotoUrl,
    artwork?.groupDriveFileId,
  ]);

  if (!artwork) return null;

  const isOwnGroup = evaluatorGroup?.groupId === artwork.groupId;
  const isOwnClass = evaluatorGroup
    ? !canAssessArtwork(evaluatorGroup.className, artwork.className)
    : false;

  const driveThumbUrl = artwork.driveFileId
    ? `https://drive.google.com/thumbnail?id=${artwork.driveFileId}&sz=w1200`
    : null;
  const displayPhotoUrl =
    !driveFailed && driveThumbUrl
      ? driveThumbUrl
      : !localFailed && artwork.photoUrl
        ? artwork.photoUrl
        : null;
  const hasPhoto = Boolean(displayPhotoUrl);

  const groupDriveThumbUrl = artwork.groupDriveFileId
    ? `https://drive.google.com/thumbnail?id=${artwork.groupDriveFileId}&sz=w1200`
    : null;
  const displayGroupPhotoUrl =
    !groupDriveFailed && groupDriveThumbUrl
      ? groupDriveThumbUrl
      : !groupLocalFailed && artwork.groupPhotoUrl
        ? artwork.groupPhotoUrl
        : null;
  const hasGroupPhoto = Boolean(displayGroupPhotoUrl);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="artwork-detail-title"
    >
      <div className="bg-white border border-[#E3DED4] rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row shadow-xl">
        {/* Left column: BOTH Foto Karya Ecoprint & Foto Kelompok Bersama Karya */}
        <div className="md:w-1/2 bg-[#F5F2EC] p-4 space-y-4 overflow-y-auto border-b md:border-b-0 md:border-r border-[#E3DED4]">
          {/* Foto 1: Foto Karya */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#1A1917]">
                1. Foto Karya Ecoprint
              </span>
              <div className="flex items-center gap-2.5">
                {artwork.photoUrl && (
                  <a
                    href={`/api/artworks/${encodeURIComponent(artwork.groupId)}/download-original?kind=artwork`}
                    download={artwork.originalFileName ?? `${artwork.groupId}.jpg`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1B4332] hover:underline"
                  >
                    <Download className="w-3 h-3" aria-hidden="true" />
                    <span>Asli</span>
                  </a>
                )}
                {artwork.driveWebViewLink && (
                  <a
                    href={artwork.driveWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1B4332] hover:underline"
                  >
                    <span>Drive</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>

            <div className="aspect-[4/3] rounded-lg bg-[#EFECE5] border border-[#E3DED4] overflow-hidden flex items-center justify-center">
              {hasPhoto ? (
                <img
                  src={displayPhotoUrl!}
                  alt={`Detail karya ecoprint ${artwork.artworkTitle}`}
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (!driveFailed && driveThumbUrl && displayPhotoUrl === driveThumbUrl) {
                      setDriveFailed(true);
                    } else {
                      setLocalFailed(true);
                    }
                  }}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                  <ImageOff className="w-8 h-8 text-[#9C9588] mb-2" aria-hidden="true" />
                  <p className="text-xs font-medium text-[#5E5A52]">
                    Foto karya belum diupload oleh Kelompok {artwork.groupId}
                  </p>
                  {isOwnGroup && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenUploadMyPhoto();
                      }}
                      className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1B4332] text-white text-xs font-semibold hover:bg-[#143326]"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Upload 2 Foto Sekarang</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Foto 2: Foto Kelompok Bersama Karya */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#1A1917]">
                <Users className="w-3.5 h-3.5 text-[#1B4332]" aria-hidden="true" />
                <span>2. Foto Kelompok Bersama Karya</span>
              </span>
              <div className="flex items-center gap-2.5">
                {artwork.groupPhotoUrl && (
                  <a
                    href={`/api/artworks/${encodeURIComponent(artwork.groupId)}/download-original?kind=group`}
                    download={artwork.groupOriginalFileName ?? `${artwork.groupId}_kelompok.jpg`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1B4332] hover:underline"
                  >
                    <Download className="w-3 h-3" aria-hidden="true" />
                    <span>Asli</span>
                  </a>
                )}
                {artwork.groupDriveWebViewLink && (
                  <a
                    href={artwork.groupDriveWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1B4332] hover:underline"
                  >
                    <span>Drive</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>

            <div className="aspect-[4/3] rounded-lg bg-[#EFECE5] border border-[#E3DED4] overflow-hidden flex items-center justify-center">
              {hasGroupPhoto ? (
                <img
                  src={displayGroupPhotoUrl!}
                  alt={`Foto kelompok ${artwork.groupId} bersama karya ${artwork.artworkTitle}`}
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (
                      !groupDriveFailed &&
                      groupDriveThumbUrl &&
                      displayGroupPhotoUrl === groupDriveThumbUrl
                    ) {
                      setGroupDriveFailed(true);
                    } else {
                      setGroupLocalFailed(true);
                    }
                  }}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                  <Users className="w-8 h-8 text-[#9C9588] mb-2" aria-hidden="true" />
                  <p className="text-xs font-medium text-[#5E5A52]">
                    Foto kelompok bersama karya belum diupload
                  </p>
                  {isOwnGroup && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenUploadMyPhoto();
                      }}
                      className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#1B4332] bg-white text-[#1B4332] text-xs font-semibold hover:bg-[#F2F7F4]"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Upload Foto Kelompok</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="md:w-1/2 p-6 flex flex-col justify-between overflow-y-auto">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-[#5E5A52] tabular-nums">
                  Kelompok {artwork.groupId} · Kelas {artwork.className} · Jenjang {artwork.grade}
                </div>
                <h2
                  id="artwork-detail-title"
                  className="font-editorial text-2xl font-semibold text-[#1A1917] mt-1"
                >
                  {artwork.artworkTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup detail karya"
                className="p-2 rounded-lg text-[#5E5A52] hover:text-[#1A1917] hover:bg-[#F0EDE6] transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-[#4A463F] mt-4 leading-relaxed">
              {artwork.description}
            </p>

            <dl className="mt-5 divide-y divide-[#ECE7DE] border-y border-[#ECE7DE] text-sm">
              {artwork.memberNames && (
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-[#5E5A52]">Nama Kelompok / Anggota</dt>
                  <dd className="font-medium text-[#1B4332] text-right">{artwork.memberNames}</dd>
                </div>
              )}
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#5E5A52]">Daun yang Digunakan</dt>
                <dd className="font-medium text-[#1A1917] text-right">{artwork.leaves}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#5E5A52]">Teknik Pembuatan</dt>
                <dd className="font-medium text-[#1A1917] text-right">{artwork.technique}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#5E5A52]">Media Kain</dt>
                <dd className="font-medium text-[#1A1917] text-right">{artwork.fabric}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#5E5A52]">Zat Fiksasi / Mordant</dt>
                <dd className="font-medium text-[#1A1917] text-right">{artwork.mordant}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 pt-4 space-y-3">
            {isOwnGroup && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenUploadMyPhoto();
                }}
                className="w-full py-2.5 px-4 rounded-lg border border-[#1B4332] bg-[#F2F7F4] hover:bg-[#1B4332] text-[#1B4332] hover:text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Edit Nama, Judul, Daun &amp; Foto Karya Saya</span>
              </button>
            )}

            {!evaluatorGroup ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenLogin();
                }}
                className="w-full py-2.5 px-4 rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                <span>Masuk dengan Password Kelompok untuk Menilai</span>
              </button>
            ) : isOwnClass ? (
              <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-center gap-2.5">
                <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  Kelompok {evaluatorGroup.groupId} (Kelas {evaluatorGroup.className}) dilarang menilai karya dari kelasnya sendiri.
                </span>
              </div>
            ) : isEvaluatorLocked ? (
              <div className="p-3.5 rounded-lg bg-[#F0EDE6] text-xs text-[#5E5A52]">
                Penilaian kelompok Anda sudah terkunci.
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-medium text-[#5E5A52]">
                  <span>Tetapkan peringkat karya ini:</span>
                  {assignedRank && (
                    <button
                      type="button"
                      onClick={() => onClearRank(artwork.groupId)}
                      className="text-[#9A3412] hover:underline"
                    >
                      Hapus Pilihan
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {RANK_CONFIG.map((cfg) => {
                    const isSelected = assignedRank === cfg.rank;
                    return (
                      <button
                        key={cfg.rank}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            onClearRank(artwork.groupId);
                          } else {
                            onAssignRank(artwork.groupId, cfg.rank);
                            onClose();
                          }
                        }}
                        className={`px-3 py-2.5 rounded-lg border text-left transition-colors flex items-center justify-between ${
                          isSelected
                            ? 'bg-[#1B4332] border-[#1B4332] text-white'
                            : 'bg-white border-[#E3DED4] text-[#1A1917] hover:border-[#1B4332]'
                        }`}
                      >
                        <span className="text-xs font-semibold">{cfg.label}</span>
                        <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums">
                          <span>{cfg.stars}</span>
                          <Star
                            className={`w-3.5 h-3.5 ${
                              isSelected
                                ? 'fill-[#FCD34D] text-[#FCD34D]'
                                : 'fill-[#B45309] text-[#B45309]'
                            }`}
                            aria-hidden="true"
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
