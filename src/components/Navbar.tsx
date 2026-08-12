import React from 'react';
import {
  ShieldCheck,
  Zap,
  Radio,
  SlidersHorizontal,
  Cloud,
  Cpu,
  Globe,
  Sparkles,
  Download,
} from 'lucide-react';
import { LanguageCode, UserSubscription } from '../types';
import { getTranslation } from '../lib/i18n';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  subscription: UserSubscription;
  onOpenUpgradeModal: () => void;
  onOpenInstallerModal: () => void;
  systemHealthScore: number;
  isScanningOrFixing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  language,
  setLanguage,
  subscription,
  onOpenUpgradeModal,
  onOpenInstallerModal,
  systemHealthScore,
  isScanningOrFixing,
}) => {
  const t = (key: string) => getTranslation(language, key);

  const tabs = [
    { id: 'dashboard', label: t('navDashboard'), icon: Zap },
    { id: 'tweaks', label: t('navTweaks'), icon: SlidersHorizontal },
    { id: 'drivers', label: t('navDrivers'), icon: Radio },
    { id: 'monitor', label: t('navMonitor'), icon: Cpu },
    { id: 'cloud', label: t('navCloudSync'), icon: Cloud },
  ];

  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-cyan-500/20 text-slate-100 shadow-xl">
      {/* Windows 11 Simulated Title Bar Header */}
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyan-500 animate-pulse" />
          <span className="font-bold tracking-wider text-cyan-400 uppercase text-[11px]">
            {t('appTitle')}
          </span>
          <span className="text-slate-500 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden sm:inline">{t('subTitle')}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Health Score Pill */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700/80 rounded-full px-3 py-0.5">
            <ShieldCheck
              className={`w-3.5 h-3.5 ${
                systemHealthScore >= 90
                  ? 'text-emerald-400'
                  : systemHealthScore >= 70
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            />
            <span className="text-slate-300 font-medium">Health:</span>
            <span
              className={`font-bold ${
                systemHealthScore >= 90
                  ? 'text-emerald-400'
                  : systemHealthScore >= 70
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {systemHealthScore}/100
            </span>
          </div>

          {/* Tier Badge */}
          <button
            onClick={onOpenUpgradeModal}
            className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full font-semibold transition ${
              subscription.tier === 'PREMIUM_CLOUD'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:brightness-110 shadow-sm shadow-cyan-500/30'
                : 'bg-slate-800 text-cyan-400 border border-cyan-500/30 hover:bg-slate-700'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            {subscription.tier === 'PREMIUM_CLOUD'
              ? t('proTierBadge')
              : t('freeTierBadge')}
          </button>

          {/* PowerShell Exporter Button */}
          <button
            onClick={onOpenInstallerModal}
            className="flex items-center gap-1 bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-0.5 rounded-full transition"
            title="Download Windows 11 PowerShell (.ps1) script or installer"
          >
            <Download className="w-3 h-3 text-cyan-400" />
            <span className="hidden md:inline">Script / Win11 Export</span>
          </button>

          {/* Language Switcher */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-full px-2 py-0.5">
            <Globe className="w-3 h-3 text-slate-400" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              <option value="en" className="bg-slate-900">EN</option>
              <option value="es" className="bg-slate-900">ES</option>
              <option value="de" className="bg-slate-900">DE</option>
              <option value="fr" className="bg-slate-900">FR</option>
              <option value="ja" className="bg-slate-900">JA</option>
              <option value="zh" className="bg-slate-900">ZH</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between overflow-x-auto no-scrollbar">
        <nav className="flex items-center gap-1 py-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                disabled={isScanningOrFixing}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                  isActive
                    ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/40 shadow-inner'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                } ${isScanningOrFixing ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
