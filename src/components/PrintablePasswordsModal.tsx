import React, { useCallback, useEffect, useState } from 'react';
import { Download, Printer, RefreshCw, X } from 'lucide-react';
import { ALL_CLASSES, type GroupPasswordItem } from '../shared/ecoprint';

interface PrintablePasswordsModalProps {
  isOpen: boolean;
  adminToken: string | null;
  onClose: () => void;
}

export const PrintablePasswordsModal: React.FC<PrintablePasswordsModalProps> = ({
  isOpen,
  adminToken,
  onClose,
}) => {
  const [passwords, setPasswords] = useState<GroupPasswordItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const loadPasswords = useCallback(async () => {
    if (!adminToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/passwords', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error ?? 'Akses ditolak.');
        return;
      }
      const data = (await res.json()) as { passwords: GroupPasswordItem[] };
      setPasswords(data.passwords);
    } catch {
      setError('Gagal memuat daftar password.');
    } finally {
      setIsLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    if (isOpen && adminToken) {
      loadPasswords();
    }
  }, [isOpen, adminToken, loadPasswords]);

  if (!isOpen || !adminToken) return null;

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const res = await fetch('/api/admin/regenerate-passwords', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { passwords: GroupPasswordItem[] };
        setPasswords(data.passwords);
        setConfirmRegen(false);
      }
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDownloadCsv = () => {
    const lines = ['Jenjang,Kelas,Kelompok,Password'];
    for (const item of passwords) {
      lines.push(`Grade ${item.grade},${item.className},${item.groupId},${item.password}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'daftar-password-kelompok-ecoprint.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print-only-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="printable-passwords-title"
    >
      <div className="bg-white border border-[#E3DED4] rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl print-only-sheet">
        {/* Toolbar (hidden when printing) */}
        <div className="px-6 py-4 border-b border-[#E3DED4] bg-[#F8F6F1] flex flex-wrap items-center justify-between gap-3 no-print">
          <div>
            <h2
              id="printable-passwords-title"
              className="font-editorial text-xl font-semibold text-[#1A1917]"
            >
              Daftar Password Seluruh Kelompok (Siap Cetak 1 Halaman)
            </h2>
            <p className="text-xs text-[#5E5A52] mt-0.5">
              52 kelompok (13 kelas × 4 kelompok) tertata dalam tata letak 1 lembar A4.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={passwords.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-[#E3DED4] bg-white text-[#1A1917] hover:bg-[#F0EDE6] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmRegen(true)}
              disabled={isRegenerating}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-[#E3DED4] bg-white text-[#9A3412] hover:bg-[#FEF2F2] transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Acak Ulang</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              disabled={passwords.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Print 1 Halaman</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup daftar password"
              className="p-2 rounded-lg text-[#5E5A52] hover:text-[#1A1917] hover:bg-[#EAE5DC] transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Confirm regenerate banner */}
        {confirmRegen && (
          <div className="px-6 py-3 bg-[#FEF2F2] border-b border-[#FECACA] flex flex-wrap items-center justify-between gap-3 text-xs no-print">
            <span className="text-[#991B1B] font-medium">
              Mengacak ulang akan mengganti semua 52 password kelompok. Kelompok yang sedang login perlu masuk ulang dengan password baru.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmRegen(false)}
                className="px-3 py-1 rounded border border-[#E3DED4] bg-white text-[#1A1917]"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isRegenerating}
                onClick={handleRegenerate}
                className="px-3 py-1 rounded bg-[#991B1B] text-white font-semibold"
              >
                {isRegenerating ? 'Membuat...' : 'Ya, Acak Ulang'}
              </button>
            </div>
          </div>
        )}

        {/* Printable 1-Page Sheet */}
        <div
          id="printable-password-sheet"
          className="p-4 sm:p-6 overflow-y-auto print-only-sheet"
        >
          {isLoading ? (
            <div className="py-12 text-center text-sm text-[#5E5A52]">
              Memuat daftar password kelompok...
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-[#991B1B]">{error}</div>
          ) : (
            <div className="space-y-2 print:space-y-1">
              <div className="flex items-baseline justify-between border-b border-[#1A1917] pb-1.5 mb-2">
                <div>
                  <h1 className="font-editorial text-base font-bold text-[#1A1917] print:text-[13px]">
                    Kartu Password Kelompok — Penilaian Ecoprint Lintas Jenjang
                  </h1>
                </div>
                <span className="text-[11px] font-mono text-[#5E5A52] print:text-[9px] tabular-nums">
                  52 Kelompok (Kelas 71–95)
                </span>
              </div>

              <div className="space-y-1.5 print:space-y-1">
                {ALL_CLASSES.map((cls) => {
                  const rowItems = passwords.filter((p) => p.className === cls.className);
                  return (
                    <div
                      key={cls.className}
                      className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-1.5 print:gap-1 break-inside-avoid"
                    >
                      {rowItems.map((item) => (
                        <div
                          key={item.groupId}
                          className="border border-dashed border-[#8A8479] rounded px-2.5 py-1.5 print:px-2 print:py-1 flex items-center justify-between gap-2 bg-white"
                        >
                          <div className="min-w-0">
                            <div className="text-[10px] print:text-[8.5px] text-[#5E5A52] leading-tight">
                              Kls {item.className} · Jnj {item.grade}
                            </div>
                            <div className="font-mono text-xs print:text-[10.5px] font-bold text-[#1A1917] tabular-nums leading-tight">
                              {item.groupId}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-[9px] print:text-[7.5px] text-[#5E5A52] leading-tight">
                              Password
                            </div>
                            <div className="font-mono text-xs print:text-[11px] font-bold tracking-wider text-[#1B4332] print:text-black tabular-nums leading-tight">
                              {item.password}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
