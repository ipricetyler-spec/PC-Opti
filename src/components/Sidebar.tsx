import React from 'react';
import {
  LayoutDashboard,
  ShieldAlert,
  Radio,
  Activity,
  Cloud,
  Settings,
  Sparkles,
  Download,
  Zap,
  HardDrive,
  ShieldCheck,
  Gamepad2,
  History,
} from 'lucide-react';
import { LanguageCode, UserSubscription } from '../types';
import { getTranslation } from '../lib/i18n';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  language: LanguageCode;
  subscription: UserSubscription;
  onOpenUpgradeModal: () => void;
  onOpenInstallerModal: () => void;
  isScanningOrFixing: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  language,
  subscription,
  onOpenUpgradeModal,
  onOpenInstallerModal,
  isScanningOrFixing,
}) => {
  const t = (key: string) => getTranslation(language, key);

  const mainNavItems = [
    { id: 'dashboard', label: 'Dashboard Overview', icon: LayoutDashboard },
    { id: 'tweaks', label: 'Verified Tweaks & Filter', icon: ShieldAlert },
    { id: 'debloat', label: 'Startup & OS Debloater', icon: Zap },
    { id: 'defrag', label: 'Disk Defrag & TRIM', icon: HardDrive },
    { id: 'sentinel', label: 'Sentinel & UEFI WMI Bridge', icon: ShieldCheck },
    { id: 'games', label: '1-Click Game Profiles', icon: Gamepad2 },
    { id: 'drivers', label: 'WHQL Driver Radar', icon: Radio },
    { id: 'monitor', label: 'Hardware Vitals', icon: Activity },
    { id: 'journal', label: 'Change Journal & Rollback', icon: History },
    { id: 'cloud', label: 'Cloud Sync', icon: Cloud },
  ];

  return (
    <aside className="w-64 bg-[#111318] border-r border-slate-800 flex flex-col justify-between shrink-0 h-screen sticky top-0">
      <div>
        {/* Brand Header */}
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center font-black text-white shadow-lg shadow-blue-900/40 text-lg">
              R
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight text-white leading-none">
                Rigor<span className="text-blue-500">set</span>
              </h1>
              <span className="text-[10px] text-slate-500 font-medium">PC Performance v2.4</span>
            </div>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="px-4 space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 mt-2 px-2">
            Main Menu
          </div>

          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                disabled={isScanningOrFixing}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-600/30 shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                } ${isScanningOrFixing ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-slate-500'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 mt-4 px-2">
            Tools & Deploy
          </div>

          <button
            onClick={onOpenInstallerModal}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <Download className="w-4 h-4 text-cyan-400" />
            <span>PowerShell Exporter</span>
          </button>
        </nav>
      </div>

      {/* Plan Card Banner */}
      <div className="p-4 bg-gradient-to-t from-[#16181d] to-transparent">
        <div className="p-4 bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-xl text-white text-center shadow-lg relative overflow-hidden">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            OWNER EDITION
          </div>
          <div className="text-sm font-extrabold text-white mt-0.5">
            Full Unrestricted Access
          </div>
          <div className="text-[11px] mt-1 text-slate-400">
            Zero Paywalls & Absolute Owner Control
          </div>

          <button
            onClick={onOpenUpgradeModal}
            className="w-full mt-3 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 transition flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>License & System Info</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
