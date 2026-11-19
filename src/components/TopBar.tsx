import React from 'react';
import { KeyRound, Lock, Users } from 'lucide-react';
import type { ArtworkGroup } from '../shared/ecoprint';

export type ActiveTab = 'assess' | 'winners' | 'recap' | 'rules' | 'admin';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  activeGroup: ArtworkGroup | null;
  isActiveGroupLocked: boolean;
  onOpenGroupSelector: () => void;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'assess', label: 'Penilaian Karya' },
  { id: 'winners', label: 'Pemenang' },
  { id: 'recap', label: 'Rekapitulasi' },
  { id: 'rules', label: 'Aturan & Panduan' },
  { id: 'admin', label: 'Admin' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  activeGroup,
  isActiveGroupLocked,
  onOpenGroupSelector,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-[#F8F6F1]/95 backdrop-blur-sm border-b border-[#E3DED4] no-print">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('assess')}
          className="font-editorial text-lg sm:text-xl font-semibold tracking-tight text-[#1A1917] whitespace-nowrap shrink-0 text-left hover:text-[#1B4332] transition-colors"
        >
          Galeri Ecoprint
        </button>

        {/* Zone 2: 5 single-line nav links */}
        <nav
          aria-label="Navigasi utama"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-2 whitespace-nowrap shrink-0 transition-colors duration-150 ${
                  isActive
                    ? 'text-[#1B4332] font-semibold'
                    : 'text-[#5E5A52] hover:text-[#1A1917]'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[1px] h-[2px] bg-[#1B4332]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenGroupSelector}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-lg bg-[#1B4332] text-white hover:bg-[#143326] transition-colors duration-150 whitespace-nowrap shrink-0"
          >
            {activeGroup ? (
              isActiveGroupLocked ? (
                <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )
            ) : (
              <KeyRound className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="font-mono tabular-nums">
              {activeGroup ? `Kelompok ${activeGroup.groupId}` : 'Masuk Kelompok'}
            </span>
          </button>
        </div>
      </div>

      {/* Compact mobile navigation row */}
      <nav
        aria-label="Navigasi seluler"
        className="md:hidden border-t border-[#E3DED4] px-4 flex items-center justify-between gap-2 overflow-x-auto"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`py-2.5 px-2 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                isActive
                  ? 'border-[#1B4332] text-[#1B4332] font-semibold'
                  : 'border-transparent text-[#5E5A52]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
