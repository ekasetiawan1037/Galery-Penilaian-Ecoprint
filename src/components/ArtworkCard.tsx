import React, { useState } from 'react';
import { Eye, ImageOff, KeyRound, Lock, Pencil, Star, Upload } from 'lucide-react';
import {
  RANK_CONFIG,
  canAssessArtwork,
  type ArtworkGroup,
  type RankNumber,
} from '../shared/ecoprint';

interface ArtworkCardProps {
  artwork: ArtworkGroup;
  evaluatorGroup: ArtworkGroup | null;
  isEvaluatorLocked: boolean;
  assignedRank?: RankNumber;
  usedRanksByOther: Map<RankNumber, string>;
  onAssignRank: (artworkGroupId: string, rank: RankNumber) => void;
  onClearRank: (artworkGroupId: string) => void;
  onInspect: (artwork: ArtworkGroup) => void;
  onOpenUploadMyPhoto: () => void;
  onOpenLogin: () => void;
}

export const ArtworkCard: React.FC<ArtworkCardProps> = ({
  artwork,
  evaluatorGroup,
  isEvaluatorLocked,
  assignedRank,
  usedRanksByOther,
  onAssignRank,
  onClearRank,
  onInspect,
  onOpenUploadMyPhoto,
  onOpenLogin,
}) => {
  const [localFailed, setLocalFailed] = useState(false);
  const [driveFailed, setDriveFailed] = useState(false);

  React.useEffect(() => {
    setLocalFailed(false);
    setDriveFailed(false);
  }, [artwork.photoUrl, artwork.driveFileId]);

  const isOwnGroup = evaluatorGroup?.groupId === artwork.groupId;
  const isOwnClass = evaluatorGroup
    ? !canAssessArtwork(evaluatorGroup.className, artwork.className)
    : false;
  const isSelected = assignedRank !== undefined;

  const driveThumbUrl = artwork.driveFileId
    ? `https://drive.google.com/thumbnail?id=${artwork.driveFileId}&sz=w1000`
    : null;
  const displayPhotoUrl =
    !localFailed && artwork.photoUrl
      ? artwork.photoUrl
      : !driveFailed && driveThumbUrl
        ? driveThumbUrl
        : null;
  const hasUploadedPhoto = Boolean(displayPhotoUrl);

  return (
    <article
      className={`bg-white rounded-xl border overflow-hidden transition-colors duration-150 flex flex-col ${
        isOwnClass
          ? 'border-[#E3DED4] bg-[#F5F2EC]/70 opacity-95'
          : isSelected
            ? 'border-[#1B4332] ring-1 ring-[#1B4332]'
            : 'border-[#E3DED4] hover:border-[#C9C1B2]'
      }`}
    >
      {/* Artwork Photo Slot */}
      <div className="relative aspect-[4/3] bg-[#EFECE5] overflow-hidden border-b border-[#ECE7DE]">
        {hasUploadedPhoto ? (
          <img
            src={displayPhotoUrl!}
            alt={`Karya ecoprint ${artwork.artworkTitle} oleh Kelompok ${artwork.groupId}`}
            referrerPolicy="no-referrer"
            onError={() => {
              if (!localFailed && artwork.photoUrl) {
                setLocalFailed(true);
              } else {
                setDriveFailed(true);
              }
            }}
            className={`w-full h-full object-cover transition-transform duration-300 ${
              isOwnClass ? 'grayscale-[35%] contrast-[0.95]' : 'hover:scale-[1.02]'
            }`}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-5 text-center">
            <ImageOff className="w-7 h-7 text-[#9C9588] mb-2" aria-hidden="true" />
            <p className="text-xs font-medium text-[#5E5A52]">
              Foto karya belum diupload
            </p>
            <p className="text-[11px] font-mono text-[#8A8479] mt-0.5 tabular-nums">
              Kelompok {artwork.groupId}
            </p>
            {isOwnGroup && (
              <button
                type="button"
                onClick={onOpenUploadMyPhoto}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white text-xs font-semibold transition-colors"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Upload Foto &amp; Edit</span>
              </button>
            )}
          </div>
        )}

        {/* Bottom Group & Detail Bar */}
        <div
          className={`absolute inset-x-0 bottom-0 px-3.5 py-2.5 flex items-center justify-between gap-2 ${
            hasUploadedPhoto
              ? 'bg-gradient-to-t from-black/75 via-black/40 to-transparent pt-7 text-white'
              : 'text-[#1A1917]'
          }`}
        >
          <span className="font-mono text-xs font-semibold tracking-wide tabular-nums">
            {artwork.groupId}
          </span>

          <button
            type="button"
            onClick={() => onInspect(artwork)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              hasUploadedPhoto
                ? 'bg-black/55 hover:bg-black/75 text-white'
                : 'bg-white/90 hover:bg-white border border-[#E3DED4] text-[#1A1917]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Detail</span>
          </button>
        </div>

        {/* Own-class block overlay */}
        {evaluatorGroup && isOwnClass && (
          <div className="absolute top-3 left-3 right-3 bg-[#1A1917]/90 text-white px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-medium">
            <Lock className="w-3.5 h-3.5 shrink-0 text-[#FCD34D]" aria-hidden="true" />
            <span className="truncate">
              {isOwnGroup
                ? `Karya Kelompok Anda (${artwork.groupId})`
                : `Kelas Sendiri (${artwork.className}) — Dilarang Dinilai`}
            </span>
          </div>
        )}

        {/* Selected Rank Indicator */}
        {!isOwnClass && isSelected && (
          <div className="absolute top-3 left-3 bg-[#1B4332] text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold shadow-sm">
            <Star className="w-3.5 h-3.5 fill-[#FBBF24] text-[#FBBF24]" aria-hidden="true" />
            <span className="tabular-nums">
              Peringkat {assignedRank} ({5 - assignedRank} Bintang)
            </span>
          </div>
        )}
      </div>

      {/* Card Body */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-4">
        <div>
          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-[#5E5A52]">
            <span>Jenjang {artwork.grade}</span>
            <span aria-hidden="true">·</span>
            <span>Kelas {artwork.className}</span>
            <span aria-hidden="true">·</span>
            <span>{artwork.technique}</span>
          </div>

          <h3 className="font-editorial text-base font-semibold text-[#1A1917] mt-1.5 leading-snug">
            {artwork.artworkTitle}
          </h3>

          {artwork.memberNames && (
            <p className="text-xs font-medium text-[#1B4332] mt-1 line-clamp-1">
              {artwork.memberNames}
            </p>
          )}

          <p className="text-xs text-[#5E5A52] mt-1 line-clamp-2">
            Daun: <span className="text-[#1A1917]">{artwork.leaves}</span>
          </p>
        </div>

        {/* Rank Selection Controls */}
        <div className="pt-3 border-t border-[#ECE7DE]">
          {!evaluatorGroup ? (
            <button
              type="button"
              onClick={onOpenLogin}
              className="w-full py-2 px-3 rounded-lg border border-[#E3DED4] bg-[#F8F6F1] hover:border-[#1B4332] text-xs font-medium text-[#1A1917] inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5 text-[#1B4332]" aria-hidden="true" />
              <span>Masuk dengan password kelompok untuk menilai</span>
            </button>
          ) : isOwnClass ? (
            <div className="flex items-center justify-between gap-2 text-xs text-[#7C2D12] font-medium py-1.5">
              <span className="inline-flex items-center gap-1.5 truncate">
                <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Diblokir (kelas {evaluatorGroup.className})</span>
              </span>
              {isOwnGroup && (
                <button
                  type="button"
                  onClick={onOpenUploadMyPhoto}
                  className="inline-flex items-center gap-1 text-[#1B4332] font-semibold hover:underline whitespace-nowrap shrink-0"
                >
                  <Pencil className="w-3 h-3" aria-hidden="true" />
                  <span>Upload / Edit Karya</span>
                </button>
              )}
            </div>
          ) : isEvaluatorLocked ? (
            <div className="text-xs text-[#5E5A52] py-1.5">
              {isSelected
                ? `Dipilih sebagai Peringkat ${assignedRank} (${5 - assignedRank}★)`
                : 'Penilaian kelompok Anda sudah terkunci'}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#5E5A52]">
                  {isSelected ? 'Ubah atau batalkan peringkat:' : 'Pilih peringkat untuk karya ini:'}
                </span>
                {isSelected && (
                  <button
                    type="button"
                    onClick={() => onClearRank(artwork.groupId)}
                    className="text-xs font-medium text-[#9A3412] hover:underline whitespace-nowrap shrink-0"
                  >
                    Batalkan
                  </button>
                )}
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {RANK_CONFIG.map((cfg) => {
                  const isThisRank = assignedRank === cfg.rank;
                  const takenBy = usedRanksByOther.get(cfg.rank);
                  return (
                    <button
                      key={cfg.rank}
                      type="button"
                      onClick={() =>
                        isThisRank
                          ? onClearRank(artwork.groupId)
                          : onAssignRank(artwork.groupId, cfg.rank)
                      }
                      title={
                        takenBy
                          ? `Peringkat ${cfg.rank} sedang dipakai ${takenBy}. Klik untuk memindahkan ke ${artwork.groupId}.`
                          : `Beri ${cfg.label} (${cfg.stars} Bintang)`
                      }
                      className={`py-2 px-1.5 rounded-lg border text-center transition-colors duration-150 ${
                        isThisRank
                          ? 'bg-[#1B4332] border-[#1B4332] text-white font-semibold'
                          : takenBy
                            ? 'bg-[#F8F6F1] border-[#E3DED4] text-[#8A8479] hover:border-[#B45309] hover:text-[#1A1917]'
                            : 'bg-white border-[#E3DED4] text-[#1A1917] hover:border-[#1B4332] hover:bg-[#F3F6F4]'
                      }`}
                    >
                      <div className="text-xs font-semibold tabular-nums leading-none">
                        P{cfg.rank}
                      </div>
                      <div
                        className={`text-[11px] tabular-nums mt-1 leading-none ${
                          isThisRank ? 'text-[#FCD34D]' : 'text-[#B45309]'
                        }`}
                      >
                        {cfg.stars}★
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
};
