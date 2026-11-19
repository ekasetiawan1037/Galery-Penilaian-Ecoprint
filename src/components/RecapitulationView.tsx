import React, { useState } from 'react';
import { Download } from 'lucide-react';
import {
  getGroupById,
  type ArtworkGroup,
  type AssessmentSubmission,
  type GradeLevel,
  type RecapitulationSummary,
} from '../shared/ecoprint';

interface RecapitulationViewProps {
  catalog: ArtworkGroup[];
  recapitulation: RecapitulationSummary;
  submissions: AssessmentSubmission[];
}

export const RecapitulationView: React.FC<RecapitulationViewProps> = ({
  catalog,
  recapitulation,
  submissions,
}) => {
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel | 'all'>('all');

  const visibleGrades: GradeLevel[] =
    selectedGrade === 'all' ? [7, 8, 9] : [selectedGrade];

  const handleDownloadCsv = () => {
    const headers = [
      'Jenjang Pemilik',
      'Peringkat Jenjang',
      'Status Juara',
      'Kelompok',
      'Kelas',
      'Nama Kelompok / Anggota',
      'Judul Karya',
      'Foto Diupload',
      'Poin dari Penilai Kelas 7',
      'Poin dari Penilai Kelas 8',
      'Poin dari Penilai Kelas 9',
      'Total Poin Lintas Jenjang',
      'Jumlah Pemilih',
      '4 Bintang',
      '3 Bintang',
      '2 Bintang',
      '1 Bintang',
    ];

    const lines: string[] = [headers.join(',')];

    ([7, 8, 9] as GradeLevel[]).forEach((grade) => {
      for (const row of recapitulation.byGrade[grade].rows) {
        const status = row.isTop2Winner
          ? `TOP 2 BEST ECOPRINT GRADE ${grade} (#${row.gradeRank})`
          : '-';
        const csvRow = [
          `Grade ${grade}`,
          row.gradeRank,
          `"${status}"`,
          row.artwork.groupId,
          row.artwork.className,
          `"${(row.artwork.memberNames || '').replace(/"/g, '""')}"`,
          `"${row.artwork.artworkTitle.replace(/"/g, '""')}"`,
          row.artwork.photoUrl ? 'Ya' : 'Belum',
          row.pointsFromGrade7,
          row.pointsFromGrade8,
          row.pointsFromGrade9,
          row.totalPoints,
          row.votesCount,
          row.rank1Count,
          row.rank2Count,
          row.rank3Count,
          row.rank4Count,
        ];
        lines.push(csvRow.join(','));
      }
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rekapitulasi-ecoprint-lintas-jenjang-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-8">
      {/* Header & CSV Export */}
      <div className="border-b border-[#E3DED4] pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#1B4332]">
            Rekapitulasi Poin Lintas Jenjang
          </p>
          <h1 className="font-editorial text-3xl sm:text-4xl font-semibold text-[#1A1917] mt-1">
            Tabel Rekapitulasi &amp; Audit Suara
          </h1>
          <p className="text-sm text-[#5E5A52] mt-2 max-w-2xl leading-relaxed">
            Setiap kolom merinci kontribusi poin dari penilai kelas 7, 8, dan 9 yang dijumlahkan penuh
            tanpa pemisahan, lalu diperingkatkan berdasarkan jenjang pemilik karya.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-[#E3DED4] bg-white text-[#1A1917] hover:bg-[#F0EDE6] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Unduh CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E3DED4] rounded-xl p-4">
          <div className="text-xs text-[#5E5A52]">Kelompok Sudah Menilai</div>
          <div className="font-mono text-2xl font-semibold text-[#1A1917] tabular-nums mt-1">
            {recapitulation.submittedGroupsCount}{' '}
            <span className="text-sm font-normal text-[#5E5A52]">
              / {recapitulation.totalGroups}
            </span>
          </div>
        </div>
        <div className="bg-white border border-[#E3DED4] rounded-xl p-4">
          <div className="text-xs text-[#5E5A52]">Foto Karya Diupload</div>
          <div className="font-mono text-2xl font-semibold text-[#1A1917] tabular-nums mt-1">
            {recapitulation.uploadedPhotosCount}{' '}
            <span className="text-sm font-normal text-[#5E5A52]">
              / {recapitulation.totalGroups}
            </span>
          </div>
        </div>
        <div className="bg-white border border-[#E3DED4] rounded-xl p-4">
          <div className="text-xs text-[#5E5A52]">Total Poin Terkumpul</div>
          <div className="font-mono text-2xl font-semibold text-[#1B4332] tabular-nums mt-1">
            {recapitulation.totalPointsDistributed}
          </div>
        </div>
        <div className="bg-white border border-[#E3DED4] rounded-xl p-4">
          <div className="text-xs text-[#5E5A52]">Total Karya Dinilai</div>
          <div className="font-mono text-2xl font-semibold text-[#B45309] tabular-nums mt-1">
            {recapitulation.totalVotesCast}{' '}
            <span className="text-xs font-sans font-normal text-[#5E5A52]">suara</span>
          </div>
        </div>
      </div>

      {/* Grade Segmented Control */}
      <div className="flex items-center gap-1 p-1 bg-[#EAE5DC] rounded-lg w-fit">
        {(['all', 7, 8, 9] as const).map((g) => {
          const isSelected = selectedGrade === g;
          return (
            <button
              key={String(g)}
              type="button"
              onClick={() => setSelectedGrade(g)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                isSelected
                  ? 'bg-white text-[#1A1917] shadow-sm'
                  : 'text-[#5E5A52] hover:text-[#1A1917]'
              }`}
            >
              {g === 'all' ? 'Semua Jenjang (7, 8, 9)' : `Jenjang Kelas ${g}`}
            </button>
          );
        })}
      </div>

      {/* Scoreboard Tables Per Grade */}
      <div className="space-y-8">
        {visibleGrades.map((grade) => {
          const recap = recapitulation.byGrade[grade];
          return (
            <div
              key={grade}
              className="bg-white border border-[#E3DED4] rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-[#E3DED4] bg-[#F8F6F1] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-editorial text-xl font-semibold text-[#1A1917]">
                    Rekapitulasi Grade {grade}
                  </h2>
                  <p className="text-xs text-[#5E5A52]">
                    {recap.classesLabel} · Peringkat 1 &amp; 2 ditetapkan sebagai {recap.title}
                  </p>
                </div>
                <span className="text-xs font-mono text-[#5E5A52] tabular-nums">
                  {recap.rows.length} karya
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E3DED4] text-xs text-[#5E5A52] bg-[#FCFBF8]">
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Pos</th>
                      <th className="py-3 px-4 font-semibold whitespace-nowrap">Kelompok</th>
                      <th className="py-3 px-4 font-semibold">Judul Karya</th>
                      <th className="py-3 px-3 font-semibold text-right whitespace-nowrap">
                        Penilai Kls 7
                      </th>
                      <th className="py-3 px-3 font-semibold text-right whitespace-nowrap">
                        Penilai Kls 8
                      </th>
                      <th className="py-3 px-3 font-semibold text-right whitespace-nowrap">
                        Penilai Kls 9
                      </th>
                      <th className="py-3 px-4 font-semibold text-right whitespace-nowrap">
                        Total Poin
                      </th>
                      <th className="py-3 px-4 font-semibold text-right whitespace-nowrap">
                        Distribusi Bintang
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE7DE]">
                    {recap.rows.map((row) => (
                      <tr
                        key={row.artwork.groupId}
                        className={
                          row.isTop2Winner
                            ? 'bg-[#F2F7F4]'
                            : 'hover:bg-[#FAF8F4] transition-colors'
                        }
                      >
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              row.isTop2Winner ? 'text-[#1B4332]' : 'text-[#5E5A52]'
                            }`}
                          >
                            #{row.gradeRank}
                          </span>
                          {row.isTop2Winner && (
                            <span className="ml-2 text-xs font-sans font-semibold text-[#1B4332]">
                              Top 2
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-[#1A1917] tabular-nums whitespace-nowrap">
                          {row.artwork.groupId}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-[#1A1917]">
                            {row.artwork.artworkTitle}
                          </div>
                          {row.artwork.memberNames && (
                            <div className="text-xs font-medium text-[#1B4332]">
                              {row.artwork.memberNames}
                            </div>
                          )}
                          <div className="text-xs text-[#5E5A52]">
                            Kelas {row.artwork.className} · {row.artwork.technique} ·{' '}
                            {row.artwork.photoUrl ? 'Foto diupload' : 'Belum ada foto'}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#5E5A52]">
                          {row.pointsFromGrade7}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#5E5A52]">
                          {row.pointsFromGrade8}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#5E5A52]">
                          {row.pointsFromGrade9}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#1B4332] tabular-nums">
                          {row.totalPoints}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-[#5E5A52] tabular-nums whitespace-nowrap">
                          4★({row.rank1Count}) · 3★({row.rank2Count}) · 2★({row.rank3Count}) · 1★({row.rank4Count})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Audit Trail of Locked Submissions */}
      <div className="bg-white border border-[#E3DED4] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E3DED4] bg-[#F8F6F1] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-editorial text-xl font-semibold text-[#1A1917]">
              Riwayat Suara Terkunci (Audit Lintas Kelas)
            </h2>
            <p className="text-xs text-[#5E5A52]">
              Membuktikan setiap kelompok hanya menilai 4 karya dari luar kelasnya sendiri.
            </p>
          </div>
          <span className="text-xs font-mono text-[#5E5A52] tabular-nums">
            {submissions.length} pengiriman
          </span>
        </div>

        {submissions.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#5E5A52]">
            Belum ada penilaian terkunci yang masuk.
          </div>
        ) : (
          <div className="divide-y divide-[#ECE7DE] max-h-[420px] overflow-y-auto">
            {[...submissions].reverse().map((sub) => (
              <div
                key={sub.evaluatorGroupId}
                className="px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono font-semibold text-sm text-[#1A1917] tabular-nums">
                    {sub.evaluatorGroupId}
                  </span>
                  <span className="text-[#5E5A52]">
                    Kelas {sub.evaluatorClassName} (Jenjang {sub.evaluatorGrade})
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums text-[#1A1917]">
                  {sub.votes.map((v) => {
                    const art = getGroupById(v.artworkGroupId, catalog);
                    return (
                      <span key={v.artworkGroupId} title={art?.artworkTitle}>
                        {v.stars === 4 ? '★★★★' : v.stars === 3 ? '★★★' : v.stars === 2 ? '★★' : '★'}: <strong>{v.artworkGroupId}</strong> ({v.stars}★)
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
