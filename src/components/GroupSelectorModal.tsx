import React, { useEffect, useState } from 'react';
import { KeyRound, Lock, LogOut, Search, X } from 'lucide-react';
import {
  GRADE_CLASSES,
  type ArtworkGroup,
  type GradeLevel,
} from '../shared/ecoprint';

interface GroupSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalog: ArtworkGroup[];
  activeGroup: ArtworkGroup | null;
  lockedGroupIds: Set<string>;
  onLoginSuccess: (groupId: string, token: string) => void;
  onLogout: () => void;
}

export const GroupSelectorModal: React.FC<GroupSelectorModalProps> = ({
  isOpen,
  onClose,
  catalog,
  activeGroup,
  lockedGroupIds,
  onLoginSuccess,
  onLogout,
}) => {
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel>(activeGroup?.grade ?? 7);
  const [pickedGroupId, setPickedGroupId] = useState<string>(activeGroup?.groupId ?? '71-1');
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setPassword('');
      if (activeGroup) {
        setSelectedGrade(activeGroup.grade);
        setPickedGroupId(activeGroup.groupId);
      }
    }
  }, [isOpen, activeGroup]);

  if (!isOpen) return null;

  const trimmedQuery = query.trim().toLowerCase();
  const classesInGrade = GRADE_CLASSES[selectedGrade];

  const matchingGroups = trimmedQuery
    ? catalog.filter(
        (g) =>
          g.groupId.toLowerCase().includes(trimmedQuery) ||
          g.className.includes(trimmedQuery) ||
          g.artworkTitle.toLowerCase().includes(trimmedQuery),
      )
    : null;

  const handleSubmitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickedGroupId || !password.trim()) {
      setError('Pilih kelompok dan masukkan password kelompok.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: pickedGroupId,
          password: password.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Password salah.');
        return;
      }
      onLoginSuccess(data.groupId, data.token);
      setPassword('');
      onClose();
    } catch {
      setError('Gagal menghubungi server untuk verifikasi password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-login-title"
    >
      <div className="bg-white border border-[#E3DED4] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-6 py-5 border-b border-[#E3DED4] flex items-start justify-between gap-4">
          <div>
            <h2
              id="group-login-title"
              className="font-editorial text-xl font-semibold text-[#1A1917]"
            >
              Masuk Kelompok dengan Password
            </h2>
            <p className="text-sm text-[#5E5A52] mt-1">
              Setiap kelompok memiliki password unik untuk mengupload foto karya dan mengirim penilaian.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog login kelompok"
            className="p-2 rounded-lg text-[#5E5A52] hover:text-[#1A1917] hover:bg-[#F0EDE6] transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Active session banner if already logged in */}
        {activeGroup && (
          <div className="px-6 py-3 bg-[#F2F7F4] border-b border-[#D5E6DA] flex items-center justify-between gap-3 text-xs">
            <span className="text-[#1B4332] font-medium">
              Sedang masuk sebagai{' '}
              <strong className="font-mono">Kelompok {activeGroup.groupId}</strong> (Kelas{' '}
              {activeGroup.className})
            </span>
            <button
              type="button"
              onClick={() => {
                onLogout();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 text-[#991B1B] font-semibold hover:underline whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Keluar</span>
            </button>
          </div>
        )}

        <div className="px-6 py-4 border-b border-[#E3DED4] bg-[#F8F6F1] space-y-3">
          <div className="relative">
            <Search
              className="w-4 h-4 text-[#5E5A52] absolute left-3.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari kode kelompok (mis. 71-1, 83-2, 95-4)..."
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-[#E3DED4] rounded-lg text-[#1A1917] placeholder:text-[#8A8479]"
            />
          </div>

          {!trimmedQuery && (
            <div className="flex items-center gap-1 p-1 bg-[#EAE5DC] rounded-lg w-fit">
              {([7, 8, 9] as GradeLevel[]).map((grade) => {
                const isSelected = selectedGrade === grade;
                return (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => setSelectedGrade(grade)}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      isSelected
                        ? 'bg-white text-[#1A1917] shadow-sm'
                        : 'text-[#5E5A52] hover:text-[#1A1917]'
                    }`}
                  >
                    Jenjang Kelas {grade}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {matchingGroups ? (
            matchingGroups.length === 0 ? (
              <p className="text-sm text-[#5E5A52] py-6 text-center">
                Tidak ada kelompok yang cocok dengan "{query}".
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {matchingGroups.map((group) => {
                  const isLocked = lockedGroupIds.has(group.groupId);
                  const isPicked = group.groupId === pickedGroupId;
                  return (
                    <button
                      key={group.groupId}
                      type="button"
                      onClick={() => {
                        setPickedGroupId(group.groupId);
                        setError(null);
                      }}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        isPicked
                          ? 'border-[#1B4332] bg-[#1B4332] text-white'
                          : 'border-[#E3DED4] bg-white hover:bg-[#F8F6F1] text-[#1A1917]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {group.groupId}
                        </span>
                        {isLocked && (
                          <Lock
                            className={`w-3.5 h-3.5 ${isPicked ? 'text-white/90' : 'text-[#5E5A52]'}`}
                            aria-label="Penilaian Terkunci"
                          />
                        )}
                      </div>
                      <div
                        className={`text-[11px] mt-1 ${
                          isPicked ? 'text-white/80' : 'text-[#5E5A52]'
                        }`}
                      >
                        {isLocked ? 'Suara Terkunci' : `Kelas ${group.className}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            classesInGrade.map((cls) => {
              const groups = catalog.filter((g) => g.className === cls);
              return (
                <div key={cls}>
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-xs font-semibold text-[#1A1917]">
                      Kelas {cls}
                    </h3>
                    <span className="text-[11px] text-[#5E5A52] tabular-nums">
                      {groups.filter((g) => lockedGroupIds.has(g.groupId)).length}/{groups.length} sudah menilai
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {groups.map((group) => {
                      const isLocked = lockedGroupIds.has(group.groupId);
                      const isPicked = group.groupId === pickedGroupId;
                      return (
                        <button
                          key={group.groupId}
                          type="button"
                          onClick={() => {
                            setPickedGroupId(group.groupId);
                            setError(null);
                          }}
                          className={`p-2.5 rounded-lg border text-left transition-colors ${
                            isPicked
                              ? 'border-[#1B4332] bg-[#1B4332] text-white'
                              : 'border-[#E3DED4] bg-white hover:bg-[#F8F6F1] text-[#1A1917]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-sm font-semibold tabular-nums">
                              {group.groupId}
                            </span>
                            {isLocked && (
                              <Lock
                                className={`w-3.5 h-3.5 ${isPicked ? 'text-white/90' : 'text-[#5E5A52]'}`}
                                aria-label="Suara Terkunci"
                              />
                            )}
                          </div>
                          <div
                            className={`text-[11px] mt-0.5 truncate ${
                              isPicked ? 'text-white/80' : 'text-[#5E5A52]'
                            }`}
                          >
                            {group.photoUrl ? 'Foto terupload' : 'Belum upload foto'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Password Input Form */}
        <form
          onSubmit={handleSubmitLogin}
          className="px-6 py-4 border-t border-[#E3DED4] bg-[#F8F6F1] space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label
                htmlFor="group-password-input"
                className="block text-xs font-semibold text-[#1A1917] mb-1.5"
              >
                Password untuk Kelompok{' '}
                <span className="font-mono text-[#1B4332]">{pickedGroupId}</span>
              </label>
              <div className="relative">
                <KeyRound
                  className="w-4 h-4 text-[#5E5A52] absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="group-password-input"
                  type="text"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value.toUpperCase())}
                  placeholder="Masukkan kode password (mis. K8P4MN)"
                  className="w-full pl-9 pr-3 py-2.5 text-sm font-mono uppercase tracking-wider bg-white border border-[#E3DED4] rounded-lg text-[#1A1917] placeholder:normal-case placeholder:tracking-normal placeholder:font-sans placeholder:text-[#8A8479]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] disabled:opacity-50 text-white transition-colors whitespace-nowrap shrink-0"
            >
              {isSubmitting ? 'Memeriksa...' : 'Masuk Kelompok'}
            </button>
          </div>

          {error && (
            <p className="text-xs font-medium text-[#991B1B]" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
};
