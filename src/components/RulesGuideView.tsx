import React, { useState } from 'react';
import { CheckCircle2, Lock, Star } from 'lucide-react';
import {
  ALL_CLASSES,
  RANK_CONFIG,
  canAssessArtwork,
} from '../shared/ecoprint';

const MAIN_RULES = [
  'Setiap kelompok memilih dan menilai tepat 4 karya dari kelompok lain.',
  'Karya yang dinilai boleh berasal dari jenjang yang sama atau jenjang yang berbeda.',
  'Kelompok DILARANG menilai karya dari kelasnya sendiri.',
  'Contoh: Kelompok 71-1 boleh menilai karya dari kelas 72, 73, 81, 82, 83, 84, 85, 91, 92, 93, 94, dan 95.',
  'Kelompok 71-1 tidak boleh menilai karya dari kelas 71.',
  'Aturan larangan kelas sendiri berlaku untuk seluruh kelompok di kelas 7, 8, dan 9.',
  'Setiap kelompok hanya boleh memberikan satu suara kepada setiap karya.',
  'Setiap kelompok wajib memberikan 4 peringkat berbeda: Peringkat 1 (4★), Peringkat 2 (3★), Peringkat 3 (2★), dan Peringkat 4 (1★).',
  'Tidak boleh ada nilai peringkat yang sama dalam satu sesi penilaian.',
  'Penilaian hanya dapat dikirim setelah keempat karya mendapatkan peringkat.',
  'Setelah dikirim, penilaian terkunci permanen dan tidak dapat diubah oleh kelompok.',
];

export const RulesGuideView: React.FC = () => {
  const [simulatedClass, setSimulatedClass] = useState('71');

  const allowedClasses = ALL_CLASSES.filter((c) =>
    canAssessArtwork(simulatedClass, c.className),
  );

  return (
    <section className="space-y-10">
      <div className="border-b border-[#E3DED4] pb-6">
        <p className="text-xs font-medium text-[#1B4332]">
          Cross-Grade Peer Assessment
        </p>
        <h1 className="font-editorial text-3xl sm:text-4xl font-semibold text-[#1A1917] mt-1">
          Aturan Penilaian & Rekapitulasi Pemenang
        </h1>
        <p className="text-sm text-[#5E5A52] mt-2 max-w-2xl leading-relaxed">
          Sistem memeriksa identitas kelas penilai dan kelas pemilik karya secara otomatis.
          Satu-satunya pembatasan adalah larangan menilai karya dari kelas sendiri.
        </p>
      </div>

      {/* Rubric & Recapitulation Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white border border-[#E3DED4] rounded-xl p-6">
          <h2 className="font-editorial text-2xl font-semibold text-[#1A1917]">
            11 Aturan Utama Penilaian
          </h2>
          <ol className="mt-4 space-y-3 text-sm text-[#3A3732]">
            {MAIN_RULES.map((rule, index) => (
              <li key={index} className="flex items-start gap-3 leading-relaxed">
                <span className="font-mono text-xs font-semibold text-[#1B4332] bg-[#F0EDE6] px-2 py-0.5 rounded mt-0.5 tabular-nums shrink-0">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Star Matrix */}
          <div className="bg-white border border-[#E3DED4] rounded-xl p-6">
            <h2 className="font-editorial text-xl font-semibold text-[#1A1917]">
              Skala Peringkat & Bintang
            </h2>
            <p className="text-xs text-[#5E5A52] mt-1">
              Keempat peringkat wajib terisi dengan nilai yang berbeda.
            </p>
            <div className="mt-4 divide-y divide-[#ECE7DE] border-y border-[#ECE7DE]">
              {RANK_CONFIG.map((cfg) => (
                <div
                  key={cfg.rank}
                  className="py-3 flex items-center justify-between text-sm"
                >
                  <span className="font-medium text-[#1A1917]">{cfg.label}</span>
                  <div className="flex items-center gap-2 font-mono font-semibold text-[#B45309] tabular-nums">
                    <span>{cfg.stars} Bintang ({cfg.stars} Poin)</span>
                    <div className="flex items-center gap-0.5" aria-hidden="true">
                      {Array.from({ length: cfg.stars }).map((_, i) => (
                        <Star
                          key={i}
                          className="w-3.5 h-3.5 fill-[#B45309] text-[#B45309]"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Winner Category Summary */}
          <div className="bg-white border border-[#E3DED4] rounded-xl p-6 flex-1">
            <h2 className="font-editorial text-xl font-semibold text-[#1A1917]">
              Pemisahan Kategori Pemenang
            </h2>
            <p className="text-xs text-[#5E5A52] mt-1 leading-relaxed">
              Semua poin dari penilai kelas 7, 8, dan 9 dijumlahkan penuh, lalu pemenang ditentukan
              berdasarkan total poin tertinggi di tiap jenjang pemilik karya:
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li className="p-3 rounded-lg bg-[#F8F6F1] border border-[#E3DED4]">
                <div className="font-semibold text-[#1B4332]">TOP 2 BEST ECOPRINT GRADE 7</div>
                <div className="text-xs text-[#5E5A52] mt-0.5">
                  Dari seluruh karya kelas 71, 72, dan 73.
                </div>
              </li>
              <li className="p-3 rounded-lg bg-[#F8F6F1] border border-[#E3DED4]">
                <div className="font-semibold text-[#1B4332]">TOP 2 BEST ECOPRINT GRADE 8</div>
                <div className="text-xs text-[#5E5A52] mt-0.5">
                  Dari seluruh karya kelas 81, 82, 83, 84, dan 85.
                </div>
              </li>
              <li className="p-3 rounded-lg bg-[#F8F6F1] border border-[#E3DED4]">
                <div className="font-semibold text-[#1B4332]">TOP 2 BEST ECOPRINT GRADE 9</div>
                <div className="text-xs text-[#5E5A52] mt-0.5">
                  Dari seluruh karya kelas 91, 92, 93, 94, dan 95.
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Interactive Class Eligibility Simulator */}
      <div className="bg-white border border-[#E3DED4] rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-[#ECE7DE]">
          <div>
            <h2 className="font-editorial text-2xl font-semibold text-[#1A1917]">
              Simulasi Kelayakan Kelas Penilai
            </h2>
            <p className="text-sm text-[#5E5A52] mt-1">
              Pilih kelas penilai untuk melihat kelas mana yang boleh dan tidak boleh dinilai.
            </p>
          </div>
          <div className="text-xs font-mono text-[#1B4332] tabular-nums">
            {allowedClasses.length} kelas diizinkan · 1 kelas diblokir ({simulatedClass})
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {ALL_CLASSES.map((c) => {
            const isActive = c.className === simulatedClass;
            return (
              <button
                key={c.className}
                type="button"
                onClick={() => setSimulatedClass(c.className)}
                className={`px-3.5 py-2 rounded-lg text-xs font-mono font-semibold border transition-colors ${
                  isActive
                    ? 'bg-[#1B4332] border-[#1B4332] text-white'
                    : 'bg-[#F8F6F1] border-[#E3DED4] text-[#1A1917] hover:border-[#1B4332]'
                }`}
              >
                Kelas {c.className}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
          {ALL_CLASSES.map((target) => {
            const allowed = canAssessArtwork(simulatedClass, target.className);
            return (
              <div
                key={target.className}
                className={`p-3 rounded-lg border text-xs ${
                  allowed
                    ? 'bg-[#F2F7F4] border-[#BBF7D0] text-[#14532D]'
                    : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                }`}
              >
                <div className="flex items-center justify-between gap-1 font-mono font-semibold">
                  <span>{target.className}</span>
                  {allowed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                </div>
                <div className="mt-1 font-medium">
                  {allowed ? 'Boleh Dinilai' : 'Dilarang'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
