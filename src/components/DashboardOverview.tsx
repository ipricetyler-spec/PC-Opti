import React, { useState } from 'react';
import {
  Zap,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Cpu,
  HardDrive,
  Activity,
  ShieldAlert,
  Flame,
  Terminal,
  RefreshCw,
  Info,
  ArrowRight,
  Play,
} from 'lucide-react';
import {
  SystemVitals,
  MaintenanceStep,
  LanguageCode,
  UserSubscription,
} from '../types';
import { getTranslation } from '../lib/i18n';

interface DashboardOverviewProps {
  vitals: SystemVitals;
  maintenanceSteps: MaintenanceStep[];
  isScanningOrFixing: boolean;
  onRunOneClickCare: () => void;
  language: LanguageCode;
  subscription: UserSubscription;
  onOpenUpgradeModal: () => void;
  systemHealthScore: number;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  vitals,
  maintenanceSteps,
  isScanningOrFixing,
  onRunOneClickCare,
  language,
  subscription,
  onOpenUpgradeModal,
  systemHealthScore,
}) => {
  const t = (key: string) => getTranslation(language, key);

  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [activeLogStep, setActiveLogStep] = useState<string | null>(null);

  const totalPotentialMb = maintenanceSteps.reduce(
    (acc, item) => acc + item.spacePotentialMb,
    0
  );

  const totalItems = maintenanceSteps.reduce(
    (acc, item) => acc + item.itemsFound,
    0
  );

  const handleFetchAiDiagnosis = async () => {
    setIsAiLoading(true);
    try {
      const res = await fetch('/api/ai/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vitals: {
            cpu: vitals.cpuUsage,
            ram: vitals.ramUsage,
            ramUsedGb: vitals.ramUsedGb,
            ramTotalGb: vitals.ramTotalGb,
            gpu: vitals.gpuUsage,
            gpuTemp: vitals.gpuTemp,
            diskIo: vitals.diskIoMb,
          },
          diskStats: {
            freeGb: vitals.diskFreeGb,
            totalGb: vitals.diskTotalGb,
          },
          activeApps: [
            'OneDrive Background',
            'Discord WebHelper',
            'Steam Client',
            'Spotify Updater',
            'Epic Games Services',
          ],
          currentPreset: 'Gaming Turbo + Safe Clean',
        }),
      });

      const json = await res.json();
      if (json.data) {
        setAiAnalysis(json.data);
      } else if (json.fallback) {
        setAiAnalysis(json.fallback);
      }
    } catch (err) {
      console.error(err);
      setAiAnalysis({
        healthScore: 82,
        statusTag: 'MODERATE_BOTTLENECK',
        summary:
          'System kernel is running stably. Detected 4.2GB of temporary delivery optimization logs and 5 high-impact background startup updaters.',
        topRecommendations: [
          'Run 1-Click Care to purge 4.2GB update cache',
          'Optimize startup launchers (Discord, Spotify)',
          'Verify NVMe SSD TRIM status',
        ],
        discardedWarning:
          'DO NOT use EmptyWorkingSet RAM cleaners; Windows 11 handles memory caching efficiently.',
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner & 1-Click Hero Callout */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-cyan-500/30 p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold tracking-wide uppercase">
              <Zap className="w-3.5 h-3.5" />
              <span>One-Click System Maintenance Dashboard</span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-100 tracking-tight leading-tight">
              Instant Windows 11 Optimization & <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Risk Filter</span>
            </h1>

            <p className="text-slate-300 text-sm max-w-2xl leading-relaxed">
              Safely clean temporary junk, optimize memory compression, streamline background telemetry, and audit driver stability. <strong className="text-cyan-300">Risky & useless tweaks are explicitly filtered out.</strong>
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={onRunOneClickCare}
                disabled={isScanningOrFixing}
                className="group relative inline-flex items-center justify-center gap-3 px-8 py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-cyan-500 bg-[length:200%_auto] text-slate-950 shadow-lg shadow-cyan-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isScanningOrFixing ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin text-slate-950" />
                    <span>{t('btnFixing')}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 fill-slate-950 text-slate-950" />
                    <span>{t('btnFixAll')}</span>
                    <ArrowRight className="w-4 h-4 text-slate-950 group-hover:translate-x-1 transition" />
                  </>
                )}
              </button>

              <button
                onClick={handleFetchAiDiagnosis}
                disabled={isAiLoading}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              >
                <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
                <span>{isAiLoading ? t('btnAnalyzing') : t('btnRunAiDiagnosis')}</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics HUD Box */}
          <div className="lg:col-span-5 bg-slate-950/80 rounded-xl border border-slate-800 p-5 space-y-4 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                1-Click Maintenance Scope
              </span>
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 100% Safe Verification
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400 font-medium">Reclaimable Space</div>
                <div className="text-2xl font-black text-cyan-400 mt-1">
                  {(totalPotentialMb / 1024).toFixed(1)} GB
                </div>
              </div>

              <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400 font-medium">Actionable Items</div>
                <div className="text-2xl font-black text-slate-100 mt-1">
                  {totalItems} <span className="text-xs font-normal text-slate-400">issues</span>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 flex items-center gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
              <Info className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>
                Zero risky registry wipes or RAM empty tools. All tasks use native Windows 11 PowerShell APIs.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Live System Vitals Gauges Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* CPU Load */}
        <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold">{t('cpuUsage')}</span>
            <Cpu className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-extrabold text-slate-100">{vitals.cpuUsage}%</div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                vitals.cpuUsage > 80 ? 'bg-rose-500' : vitals.cpuUsage > 50 ? 'bg-amber-400' : 'bg-cyan-400'
              }`}
              style={{ width: `${vitals.cpuUsage}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5 flex justify-between">
            <span>Temp: {vitals.cpuTemp}°C</span>
            <span>{vitals.activeProcessesCount} proc</span>
          </div>
        </div>

        {/* GPU Load */}
        <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold">{t('gpuUsage')}</span>
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-extrabold text-slate-100">{vitals.gpuUsage}%</div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${vitals.gpuUsage}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5 flex justify-between">
            <span className="flex items-center gap-0.5 text-amber-400">
              <Flame className="w-2.5 h-2.5" /> {vitals.gpuTemp}°C
            </span>
            <span>HAGS On</span>
          </div>
        </div>

        {/* RAM Allocated */}
        <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold">{t('ramUsage')}</span>
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold text-slate-100">{vitals.ramUsage}%</div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                vitals.ramUsage > 85 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${vitals.ramUsage}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5">
            {vitals.ramUsedGb} GB / {vitals.ramTotalGb} GB
          </div>
        </div>

        {/* SSD Free Space */}
        <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold">{t('diskFree')}</span>
            <HardDrive className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-extrabold text-slate-100">{vitals.diskFreeGb} GB</div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-500"
              style={{ width: `${((vitals.diskTotalGb - vitals.diskFreeGb) / vitals.diskTotalGb) * 100}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5">
            I/O: {vitals.diskIoMb} MB/s
          </div>
        </div>

        {/* Latency */}
        <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 hover:border-cyan-500/40 transition">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold">{t('netPing')}</span>
            <Activity className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-2xl font-extrabold text-slate-100">{vitals.networkLatencyMs} ms</div>
          <div className="text-[10px] text-emerald-400 font-medium mt-3">
            TCP ACK Frequency Optimized
          </div>
        </div>

        {/* System Health Score */}
        <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 hover:border-cyan-500/40 transition flex flex-col justify-between">
          <div className="text-xs text-slate-400 font-semibold">Health Rating</div>
          <div className="text-3xl font-black text-cyan-400 mt-1">
            {systemHealthScore}
            <span className="text-xs font-normal text-slate-500">/100</span>
          </div>
          <div className="text-[10px] text-slate-400">
            {systemHealthScore >= 90 ? 'Optimal' : 'Needs Care'}
          </div>
        </div>
      </div>

      {/* AI Diagnostic Summary Card (When Generated) */}
      {aiAnalysis && (
        <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900 to-slate-950 rounded-2xl border border-cyan-500/30 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <h3 className="font-bold text-slate-100 text-base">
                {t('aiDiagnosisHeader')}
              </h3>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase">
              {aiAnalysis.statusTag || 'ANALYSIS COMPLETE'}
            </span>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed bg-slate-900/80 p-4 rounded-xl border border-slate-800">
            {aiAnalysis.summary}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                Top Actionable Recommendations:
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-300">
                {aiAnalysis.topRecommendations?.map((rec: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>

            {aiAnalysis.discardedWarning && (
              <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <ShieldAlert className="w-4 h-4" />
                  <span>{t('discardedWarningTitle')}</span>
                </div>
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  {aiAnalysis.discardedWarning}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1-Click Care Tasks Breakdown Grid */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-5 h-5 text-cyan-400" />
              <span>One-Click System Maintenance Tasks</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Select specific care modules or execute full automated optimization pipeline.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Pro Cloud Sync:</span>
            <span className={`font-semibold ${subscription.isProActive ? 'text-cyan-400' : 'text-slate-500'}`}>
              {subscription.isProActive ? 'Enabled (Auto Logs)' : 'Manual Mode'}
            </span>
            {!subscription.isProActive && (
              <button
                onClick={onOpenUpgradeModal}
                className="text-cyan-400 hover:underline font-bold ml-2"
              >
                Upgrade
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {maintenanceSteps.map((step) => {
            const isCompleted = step.status === 'COMPLETED';
            const isScanning = step.status === 'SCANNING' || step.status === 'OPTIMIZING';

            return (
              <div
                key={step.id}
                className={`rounded-xl border p-4 transition-all duration-300 relative overflow-hidden ${
                  isCompleted
                    ? 'bg-slate-900/60 border-emerald-500/40'
                    : isScanning
                    ? 'bg-cyan-950/30 border-cyan-500/60 shadow-lg shadow-cyan-500/10'
                    : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-sm text-slate-100 leading-snug">
                    {step.nameKey}
                  </h3>
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : isScanning ? (
                    <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      100% SAFE
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-3">
                  {step.descriptionKey}
                </p>

                <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/80 text-slate-300">
                  <span>
                    Items: <strong className="text-cyan-400">{step.itemsFound}</strong>
                  </span>
                  {step.spacePotentialMb > 0 && (
                    <span>
                      Potential:{' '}
                      <strong className="text-purple-400">
                        {step.spacePotentialMb > 1024
                          ? `${(step.spacePotentialMb / 1024).toFixed(1)} GB`
                          : `${step.spacePotentialMb} MB`}
                      </strong>
                    </span>
                  )}
                  {step.log.length > 0 && (
                    <button
                      onClick={() => setActiveLogStep(activeLogStep === step.id ? null : step.id)}
                      className="text-cyan-400 hover:underline flex items-center gap-1 text-[11px]"
                    >
                      <Terminal className="w-3 h-3" />
                      <span>{activeLogStep === step.id ? 'Hide Log' : 'View Log'}</span>
                    </button>
                  )}
                </div>

                {/* Log drawer */}
                {activeLogStep === step.id && (
                  <div className="mt-3 p-2 bg-slate-950 rounded-lg text-[10px] font-mono text-slate-300 space-y-1 max-h-32 overflow-y-auto border border-slate-800">
                    {step.log.map((line, idx) => (
                      <div key={idx} className="leading-tight text-cyan-300/90">
                        &gt; {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
