import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Lock,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  RANK_CONFIG,
  getGroupById,
  validateAssessmentSubmission,
  type ArtworkGroup,
  type AssessmentSubmission,
  type RankNumber,
  type RankedVoteInput,
} from '../shared/ecoprint';

interface AssessmentPanelProps {
  catalog: ArtworkGroup[];
  evaluatorGroup: ArtworkGroup | null;
  lockedSubmission?: AssessmentSubmission;
  draftVotes: Map<RankNumber, string>;
  existingSubmissions: AssessmentSubmission[];
  isSubmitting: boolean;
  submitError: string | null;
  onRemoveRank: (rank: RankNumber) => void;
  onClearAllDraft: () => void;
  onSubmitAssessment: () => Promise<boolean>;
  onSwitchGroup: () => void;
  onOpenUploadMyPhoto: () => void;
}

export const AssessmentPanel: React.FC<AssessmentPanelProps> = ({
  catalog,
  evaluatorGroup,
  lockedSubmission,
  draftVotes,
  existingSubmissions,
  isSubmitting,
  submitError,
  onRemoveRank,
  onClearAllDraft,
  onSubmitAssessment,
  onSwitchGroup,
  onOpenUploadMyPhoto,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Unauthenticated state
  if (!evaluatorGroup) {
    return (
      <aside className="bg-white border border-[#E3DED4] rounded-xl p-6 lg:sticky lg:top-24 space-y-4">
        <div>
          <div className="text-xs font-medium text-[#1B4332]">
            Akses Kelompok Penilai
          </div>
          <h2 className="font-editorial text-xl font-semibold text-[#1A1917] mt-1">
            Masuk dengan Password Kelompok
          </h2>
          <p className="text-sm text-[#5E5A52] mt-2 leading-relaxed">
            Setiap kelompok memiliki password unik. Masuk terlebih dahulu untuk mengupload foto karya kelompok Anda dan memilih 4 karya terbaik lintas kelas.
          </p>
        </div>

        <button
          type="button"
          onClick={onSwitchGroup}
          className="w-full py-3 px-4 rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <KeyRound className="w-4 h-4" aria-hidden="true" />
          <span>Masuk Kelompok Sekarang</span>
        </button>

        <div className="pt-3 border-t border-[#ECE7DE] space-y-1.5 text-xs text-[#5E5A52]">
          <p>1. Pilih kode kelompok Anda (mis. 71-1).</p>
          <p>2. Masukkan password dari kartu password kelompok.</p>
          <p>3. Upload foto karya asli kelompok, lalu beri peringkat 4 karya lain.</p>
        </div>
      </aside>
    );
  }

  // Locked state view
  if (lockedSubmission) {
    return (
      <aside className="bg-white border border-[#E3DED4] rounded-xl p-5 lg:sticky lg:top-24 space-y-4">
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#ECE7DE]">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1B4332]">
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Penilaian Terkunci Permanen</span>
            </div>
            <h2 className="font-editorial text-xl font-semibold text-[#1A1917] mt-1">
              Kelompok {lockedSubmission.evaluatorGroupId}
            </h2>
            <p className="text-xs text-[#5E5A52] mt-0.5">
              Kelas {lockedSubmission.evaluatorClassName} · Jenjang {lockedSubmission.evaluatorGrade}
            </p>
          </div>

          <button
            type="button"
            onClick={onSwitchGroup}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E3DED4] text-[#1A1917] hover:bg-[#F8F6F1] transition-colors whitespace-nowrap shrink-0"
          >
            Ganti
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenUploadMyPhoto}
          className="w-full py-2.5 px-3 rounded-lg border border-[#1B4332] text-[#1B4332] hover:bg-[#1B4332] hover:text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            {evaluatorGroup.photoUrl
              ? 'Lihat / Ganti Foto Karya Saya'
              : 'Upload Foto Karya Kelompok Saya'}
          </span>
        </button>

        <div className="space-y-2.5">
          <p className="text-xs text-[#5E5A52] leading-relaxed">
            Suara telah tercatat dan dikunci pada{' '}
            <span className="font-mono text-[#1A1917]">
              {new Date(lockedSubmission.submittedAt).toLocaleString('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
            . Penilaian tidak dapat diubah kembali.
          </p>

          <div className="space-y-2 pt-1">
            {lockedSubmission.votes.map((vote) => {
              const artwork = getGroupById(vote.artworkGroupId, catalog);
              return (
                <div
                  key={vote.artworkGroupId}
                  className="p-3 rounded-lg bg-[#F8F6F1] border border-[#E3DED4] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-[#5E5A52]">
                      <span className="font-mono font-semibold text-[#1A1917] tabular-nums">
                        Peringkat {vote.rank}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{vote.artworkGroupId}</span>
                      <span aria-hidden="true">·</span>
                      <span>Kelas {vote.artworkClassName}</span>
                    </div>
                    <p className="text-sm font-medium text-[#1A1917] truncate mt-0.5">
                      {artwork?.artworkTitle ?? vote.artworkGroupId}
                    </p>
                  </div>

                  <div className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-[#B45309] shrink-0 tabular-nums">
                    <span>{vote.stars}</span>
                    <Star className="w-3.5 h-3.5 fill-[#B45309] text-[#B45309]" aria-hidden="true" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-3 border-t border-[#ECE7DE] flex items-center gap-2 text-xs text-[#1B4332]">
          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>4 karya lintas kelas telah dihitung dalam rekapitulasi jenjang.</span>
        </div>
      </aside>
    );
  }

  // Unlocked Assessment Ballot
  const votesArray: RankedVoteInput[] = [];
  draftVotes.forEach((artworkGroupId, rank) => {
    votesArray.push({ artworkGroupId, rank });
  });

  const validation = validateAssessmentSubmission(
    evaluatorGroup.groupId,
    votesArray,
    existingSubmissions,
  );

  const filledCount = draftVotes.size;
  const allFourFilled = filledCount === 4 && validation.valid;

  const handleConfirmSubmit = async () => {
    const ok = await onSubmitAssessment();
    if (ok) {
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <aside className="bg-white border border-[#E3DED4] rounded-xl p-5 lg:sticky lg:top-24">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#ECE7DE]">
          <div>
            <div className="text-xs font-medium text-[#1B4332]">
              Lembar Penilaian Lintas Jenjang
            </div>
            <h2 className="font-editorial text-xl font-semibold text-[#1A1917] mt-0.5">
              Penilai: Kelompok {evaluatorGroup.groupId}
            </h2>
            <p className="text-xs text-[#5E5A52] mt-0.5">
              Kelas {evaluatorGroup.className} · Jenjang {evaluatorGroup.grade} · Dilarang menilai kelas {evaluatorGroup.className}
            </p>
          </div>
          <button
            type="button"
            onClick={onSwitchGroup}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E3DED4] text-[#1A1917] hover:bg-[#F8F6F1] transition-colors whitespace-nowrap shrink-0"
          >
            Ganti
          </button>
        </div>

        {/* Upload Own Artwork Action */}
        <div className="py-3 border-b border-[#ECE7DE]">
          <button
            type="button"
            onClick={onOpenUploadMyPhoto}
            className="w-full py-2.5 px-3 rounded-lg border border-[#1B4332] bg-[#F2F7F4] hover:bg-[#1B4332] text-[#1B4332] hover:text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {evaluatorGroup.photoUrl
                ? 'Foto Karya Terupload — Kelola'
                : 'Upload Foto Karya Kelompok Saya'}
            </span>
          </button>
        </div>

        {/* 4 Rank Slots */}
        <div className="py-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#1A1917] tabular-nums">
              Daftar Peringkat Terpilih ({filledCount}/4)
            </span>
            {filledCount > 0 && (
              <button
                type="button"
                onClick={onClearAllDraft}
                className="text-xs text-[#9A3412] hover:underline whitespace-nowrap shrink-0"
              >
                Kosongkan
              </button>
            )}
          </div>

          {RANK_CONFIG.map((cfg) => {
            const selectedId = draftVotes.get(cfg.rank);
            const selectedArt = selectedId ? getGroupById(selectedId, catalog) : undefined;

            return (
              <div
                key={cfg.rank}
                className={`p-3 rounded-lg border transition-colors ${
                  selectedArt
                    ? 'bg-[#F8F6F1] border-[#1B4332]/40'
                    : 'bg-white border-dashed border-[#D6CFC2]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#1A1917]">
                    <span className="tabular-nums">{cfg.label}</span>
                    <span aria-hidden="true" className="text-[#8A8479]">·</span>
                    <span className="inline-flex items-center gap-1 text-[#B45309] font-mono tabular-nums">
                      <span>{cfg.stars}</span>
                      <Star className="w-3 h-3 fill-[#B45309] text-[#B45309]" aria-hidden="true" />
                    </span>
                  </div>

                  {selectedArt && (
                    <button
                      type="button"
                      onClick={() => onRemoveRank(cfg.rank)}
                      aria-label={`Hapus ${selectedArt.groupId} dari Peringkat ${cfg.rank}`}
                      className="p-1 rounded text-[#5E5A52] hover:text-[#991B1B] hover:bg-[#FEE2E2] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {selectedArt ? (
                  <div className="mt-1.5">
                    <p className="text-sm font-medium text-[#1A1917] truncate">
                      {selectedArt.artworkTitle}
                    </p>
                    <p className="text-xs text-[#5E5A52] font-mono tabular-nums mt-0.5">
                      Kelompok {selectedArt.groupId} · Kelas {selectedArt.className} · Jenjang {selectedArt.grade}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[#8A8479] mt-1">
                    Pilih tombol P{cfg.rank} ({cfg.stars}★) pada salah satu karya di galeri.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Rule Verification Checklist */}
        <div className="py-3.5 border-t border-[#ECE7DE] space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2
              className={`w-4 h-4 shrink-0 ${
                filledCount === 4 ? 'text-[#1B4332]' : 'text-[#C9C1B2]'
              }`}
              aria-hidden="true"
            />
            <span className={filledCount === 4 ? 'text-[#1A1917] font-medium' : 'text-[#5E5A52]'}>
              Tepat 4 karya terpilih ({filledCount}/4)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2
              className={`w-4 h-4 shrink-0 ${
                validation.code !== 'SAME_CLASS_FORBIDDEN' ? 'text-[#1B4332]' : 'text-[#991B1B]'
              }`}
              aria-hidden="true"
            />
            <span className="text-[#1A1917]">
              Bebas kelas sendiri (≠ Kelas {evaluatorGroup.className})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2
              className={`w-4 h-4 shrink-0 ${
                filledCount === 4 ? 'text-[#1B4332]' : 'text-[#C9C1B2]'
              }`}
              aria-hidden="true"
            />
            <span className={filledCount === 4 ? 'text-[#1A1917] font-medium' : 'text-[#5E5A52]'}>
              4 peringkat berbeda (4★, 3★, 2★, 1★)
            </span>
          </div>
        </div>

        {submitError && (
          <div className="mb-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Submit CTA */}
        <button
          type="button"
          disabled={!allFourFilled || isSubmitting}
          onClick={() => setConfirmOpen(true)}
          className={`w-full py-3 px-4 rounded-lg text-sm font-semibold transition-colors duration-150 flex items-center justify-center gap-2 ${
            allFourFilled && !isSubmitting
              ? 'bg-[#1B4332] hover:bg-[#143326] text-white'
              : 'bg-[#EAE5DC] text-[#8A8479] cursor-not-allowed'
          }`}
        >
          <Lock className="w-4 h-4" aria-hidden="true" />
          <span>
            {isSubmitting
              ? 'Mengirim Penilaian...'
              : allFourFilled
                ? 'Kirim & Kunci Penilaian'
                : `Lengkapi ${4 - filledCount} Peringkat Lagi`}
          </span>
        </button>

        <p className="text-[11px] text-[#5E5A52] text-center mt-2.5 leading-snug">
          Setelah dikirim, penilaian kelompok {evaluatorGroup.groupId} terkunci permanen.
        </p>
      </aside>

      {/* Lock Confirmation Modal */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-lock-title"
        >
          <div className="bg-white border border-[#E3DED4] rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-2.5 text-[#1B4332]">
              <Lock className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h3
                id="confirm-lock-title"
                className="font-editorial text-lg font-semibold text-[#1A1917]"
              >
                Kirim & Kunci Penilaian?
              </h3>
            </div>

            <p className="text-sm text-[#5E5A52] mt-2 leading-relaxed">
              Penilaian dari <strong className="text-[#1A1917]">Kelompok {evaluatorGroup.groupId}</strong>{' '}
              akan dikunci secara permanen dan tidak dapat diubah lagi setelah dikirim.
            </p>

            <div className="mt-4 space-y-1.5 bg-[#F8F6F1] border border-[#E3DED4] rounded-lg p-3.5 text-xs">
              {RANK_CONFIG.map((cfg) => {
                const artId = draftVotes.get(cfg.rank)!;
                const art = getGroupById(artId, catalog);
                return (
                  <div key={cfg.rank} className="flex items-center justify-between gap-2">
                    <span className="text-[#5E5A52] tabular-nums">
                      Peringkat {cfg.rank} ({cfg.stars}★):
                    </span>
                    <span className="font-mono font-semibold text-[#1A1917] truncate">
                      {art?.groupId} · {art?.artworkTitle}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-[#E3DED4] text-[#1A1917] hover:bg-[#F8F6F1] transition-colors"
              >
                Periksa Kembali
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white transition-colors"
              >
                {isSubmitting ? 'Menyimpan...' : 'Ya, Kirim & Kunci'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
