import React, { useState } from 'react';
import { Award, ImageOff, Star } from 'lucide-react';
import type { ArtworkScoreRow, GradeLevel, RecapitulationSummary } from '../shared/ecoprint';

interface WinnersViewProps {
  recapitulation: RecapitulationSummary;
}

const WinnerCard: React.FC<{ row: ArtworkScoreRow; position: 1 | 2 }> = ({
  row,
  position,
}) => {
  const [localFailed, setLocalFailed] = useState(false);
  const [driveFailed, setDriveFailed] = useState(false);

  React.useEffect(() => {
    setLocalFailed(false);
    setDriveFailed(false);
  }, [row.artwork.photoUrl, row.artwork.driveFileId]);

  const hasPoints = row.totalPoints > 0;
  const driveThumbUrl = row.artwork.driveFileId
    ? `https://drive.google.com/thumbnail?id=${row.artwork.driveFileId}&sz=w1000`
    : null;
  const displayPhotoUrl =
    !localFailed && row.artwork.photoUrl
      ? row.artwork.photoUrl
      : !driveFailed && driveThumbUrl
        ? driveThumbUrl
        : null;
  const hasPhoto = Boolean(displayPhotoUrl);

  return (
    <article className="bg-white border border-[#E3DED4] rounded-xl overflow-hidden flex flex-col sm:flex-row">
      <div className="sm:w-52 aspect-[4/3] sm:aspect-auto bg-[#EFECE5] relative shrink-0 flex items-center justify-center">
        {hasPhoto ? (
          <img
            src={displayPhotoUrl!}
            alt={`Karya juara ${row.artwork.artworkTitle}`}
            referrerPolicy="no-referrer"
            onError={() => {
              if (!localFailed && row.artwork.photoUrl) {
                setLocalFailed(true);
              } else {
                setDriveFailed(true);
              }
            }}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
            <ImageOff className="w-6 h-6 text-[#9C9588] mb-1.5" aria-hidden="true" />
            <span className="text-[11px] text-[#5E5A52]">Belum ada foto</span>
          </div>
        )}
        <div className="absolute top-3 left-3 bg-[#1A1917]/90 text-white px-2.5 py-1 rounded-md text-xs font-semibold tabular-nums">
          Juara {position}
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#5E5A52]">
            <span className="font-mono font-semibold text-[#1B4332] tabular-nums">
              {row.artwork.groupId}
            </span>
            <span aria-hidden="true">·</span>
            <span>Kelas {row.artwork.className}</span>
            <span aria-hidden="true">·</span>
            <span>{row.artwork.technique}</span>
          </div>

          <h4 className="font-editorial text-xl font-semibold text-[#1A1917] mt-1">
            {row.artwork.artworkTitle}
          </h4>
          {row.artwork.memberNames && (
            <p className="text-xs font-medium text-[#1B4332] mt-0.5">
              {row.artwork.memberNames}
            </p>
          )}
          <p className="text-xs text-[#5E5A52] mt-1">
            Daun: {row.artwork.leaves} · {row.artwork.fabric}
          </p>
        </div>

        <div className="pt-3 border-t border-[#ECE7DE] flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium text-[#5E5A52]">
              Akumulasi Poin Penilai Lintas Jenjang
            </div>
            <div className="text-xs font-mono text-[#1A1917] mt-1 tabular-nums">
              Kls 7 ({row.pointsFromGrade7}) + Kls 8 ({row.pointsFromGrade8}) + Kls 9 ({row.pointsFromGrade9})
            </div>
            <div className="text-[11px] text-[#5E5A52] font-mono tabular-nums mt-1">
              {row.votesCount} suara · 4★×{row.rank1Count} · 3★×{row.rank2Count} · 2★×{row.rank3Count} · 1★×{row.rank4Count}
            </div>
          </div>

          <div className="text-right">
            <div className="text-2xl font-mono font-bold text-[#1B4332] tabular-nums leading-none">
              {hasPoints ? row.totalPoints : 0}
            </div>
            <div className="text-[11px] text-[#5E5A52] mt-1">Total Poin</div>
          </div>
        </div>
      </div>
    </article>
  );
};

export const WinnersView: React.FC<WinnersViewProps> = ({ recapitulation }) => {
  const grades: GradeLevel[] = [7, 8, 9];

  return (
    <section className="space-y-10">
      <div className="border-b border-[#E3DED4] pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#1B4332]">
            Hasil Akhir Terpisah Per Jenjang Pemilik Karya
          </p>
          <h1 className="font-editorial text-3xl sm:text-4xl font-semibold text-[#1A1917] mt-1">
            Pemenang Ecoprint Terbaik
          </h1>
          <p className="text-sm text-[#5E5A52] mt-2 max-w-2xl leading-relaxed">
            Seluruh poin yang diberikan oleh kelompok penilai dari kelas 7, kelas 8, dan kelas 9
            dijumlahkan secara penuh, kemudian diambil 2 peraih poin tertinggi pada masing-masing jenjang.
          </p>
        </div>

        <div className="flex items-center gap-6 text-sm shrink-0">
          <div>
            <div className="text-xs text-[#5E5A52]">Kelompok Terkunci</div>
            <div className="font-mono text-xl font-semibold text-[#1A1917] tabular-nums">
              {recapitulation.submittedGroupsCount}/{recapitulation.totalGroups}
            </div>
          </div>
          <div className="h-8 w-px bg-[#E3DED4]" aria-hidden="true" />
          <div>
            <div className="text-xs text-[#5E5A52]">Total Poin Lintas Jenjang</div>
            <div className="font-mono text-xl font-semibold text-[#1B4332] tabular-nums">
              {recapitulation.totalPointsDistributed}
            </div>
          </div>
        </div>
      </div>

      {grades.map((grade) => {
        const gradeData = recapitulation.byGrade[grade];
        return (
          <div key={grade} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
              <div className="flex items-center gap-2.5">
                <Award className="w-5 h-5 text-[#B45309] shrink-0" aria-hidden="true" />
                <h2 className="font-editorial text-2xl font-semibold text-[#1A1917]">
                  {gradeData.title}
                </h2>
              </div>
              <p className="text-xs text-[#5E5A52]">
                Cakupan karya: {gradeData.classesLabel} ({gradeData.rows.length} kelompok)
              </p>
            </div>

            {recapitulation.submittedGroupsCount === 0 ? (
              <div className="bg-white border border-[#E3DED4] rounded-xl p-8 text-center">
                <Star className="w-6 h-6 text-[#8A8479] mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-[#1A1917]">
                  Belum ada penilaian terkunci yang masuk.
                </p>
                <p className="text-xs text-[#5E5A52] mt-1">
                  Pemenang Grade {grade} akan otomatis tampil setelah kelompok mulai mengirimkan penilaian.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {gradeData.top2Winners.map((row, idx) => (
                  <WinnerCard
                    key={row.artwork.groupId}
                    row={row}
                    position={(idx + 1) as 1 | 2}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};
