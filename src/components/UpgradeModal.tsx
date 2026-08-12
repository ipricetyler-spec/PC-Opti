import React from 'react';
import {
  Sparkles,
  X,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Cloud,
  Radio,
  Clock,
  Lock,
} from 'lucide-react';
import { UserSubscription, LanguageCode } from '../types';
import { getTranslation } from '../lib/i18n';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: UserSubscription;
  onUpgradeToPro: () => void;
  language: LanguageCode;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  isOpen,
  onClose,
  subscription,
  onUpgradeToPro,
  language,
}) => {
  if (!isOpen) return null;
  const t = (key: string) => getTranslation(language, key);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#111318] border border-blue-500/30 rounded-2xl max-w-2xl w-full p-6 sm:p-8 space-y-6 relative shadow-2xl overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Rigorset Owner Edition — Unrestricted Build</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
            System Status & Owner Capabilities
          </h2>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            Your private Owner Edition operates with zero locks, zero paywalls, and complete access to all low-level Windows 11 optimization engines, WMI providers, and diagnostic APIs.
          </p>
        </div>

        {/* Owner Unrestricted Card */}
        <div className="bg-gradient-to-b from-slate-900 via-[#0a0b0d] to-[#0a0b0d] rounded-xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="font-extrabold text-amber-400 text-base">Owner Unrestricted License</span>
              <p className="text-[11px] text-slate-400">Private Development Build</p>
            </div>
            <span className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-extrabold px-3 py-1 rounded-full">
              ACTIVE & UNLOCKED
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Unlimited Gemini 3.6 AI Diagnostics</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Full Anti-Cheat Sentinel Preflight</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Direct UEFI / ACPI WMI Provider Control</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Deterministic Change Journal & Rollback</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>WHQL Driver Radar & Auto-Check</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>PowerShell Exporter & Script Deployer</span>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs shadow-lg transition"
            >
              Close & Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
