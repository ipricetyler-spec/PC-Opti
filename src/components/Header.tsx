import React from 'react';
import { ShieldCheck, Globe, Sparkles, Activity, Award, Lock, Unlock } from 'lucide-react';
import { LanguageCode, UserSubscription } from '../types';
import { getTranslation } from '../lib/i18n';

interface HeaderProps {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  subscription: UserSubscription;
  onOpenUpgradeModal: () => void;
  systemHealthScore: number;
  onToggleOwnerMode?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  language,
  setLanguage,
  subscription,
  onOpenUpgradeModal,
  systemHealthScore,
  onToggleOwnerMode,
}) => {
  const t = (key: string) => getTranslation(language, key);

  return (
    <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-[#0a0b0d]/80 backdrop-blur-md sticky top-0 z-30">
      {/* Left System Status */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:inline">
          SYSTEM STATUS:
        </span>
        <span className="flex items-center gap-2 text-emerald-400 text-xs font-bold bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span>REAL-TIME GUARD ACTIVE</span>
        </span>

        {/* Owner Edition Badge */}
        <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-full text-xs font-bold tracking-wide">
          <Award className="w-3.5 h-3.5 text-amber-400" />
          <span>OWNER EDITION — UNRESTRICTED</span>
        </div>
      </div>

      {/* Right Sync Latency & Profile Controls */}
      <div className="flex items-center gap-4 text-xs">
        {/* Latency badge */}
        <div className="hidden md:flex items-center gap-2 text-slate-400">
          <Activity className="w-3.5 h-3.5 text-blue-400" />
          <span className="opacity-60">Sync Latency:</span>
          <span className="text-blue-400 font-semibold">12ms</span>
        </div>

        <div className="h-6 w-px bg-slate-800 hidden md:block" />

        {/* Health Score Pill */}
        <div className="flex items-center gap-1.5 bg-[#111318] border border-slate-800 px-3 py-1 rounded-full">
          <ShieldCheck
            className={`w-3.5 h-3.5 ${
              systemHealthScore >= 90
                ? 'text-emerald-400'
                : systemHealthScore >= 70
                ? 'text-amber-400'
                : 'text-rose-400'
            }`}
          />
          <span className="text-slate-400 font-medium">Health:</span>
          <span className="font-bold text-white">{systemHealthScore}%</span>
        </div>

        {/* Language selector */}
        <div className="flex items-center gap-1.5 bg-[#111318] border border-slate-800 rounded-full px-2.5 py-1 text-slate-300">
          <Globe className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as LanguageCode)}
            className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer text-xs"
          >
            <option value="en" className="bg-[#111318]">EN</option>
            <option value="es" className="bg-[#111318]">ES</option>
            <option value="de" className="bg-[#111318]">DE</option>
            <option value="fr" className="bg-[#111318]">FR</option>
            <option value="ja" className="bg-[#111318]">JA</option>
            <option value="zh" className="bg-[#111318]">ZH</option>
          </select>
        </div>

        {/* Device identity */}
        <div className="flex items-center gap-3 pl-2 border-l border-slate-800">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-bold text-slate-200">Win11-Desktop-X6</div>
            <div className="text-[10px] text-slate-500">v2.4.1 Stable Build</div>
          </div>
          <button
            onClick={onOpenUpgradeModal}
            className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold hover:bg-blue-600/30 transition"
            title="Profile & Cloud Settings"
          >
            <Sparkles className="w-4 h-4 text-blue-400" />
          </button>
        </div>
      </div>
    </header>
  );
};
