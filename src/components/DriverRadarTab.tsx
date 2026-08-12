import React, { useState } from 'react';
import {
  Radio,
  CheckCircle2,
  AlertTriangle,
  Download,
  Sparkles,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Cpu,
} from 'lucide-react';
import { DriverItem, LanguageCode } from '../types';
import { getTranslation } from '../lib/i18n';

interface DriverRadarTabProps {
  drivers: DriverItem[];
  onUpdateDriver: (id: string) => void;
  language: LanguageCode;
}

export const DriverRadarTab: React.FC<DriverRadarTabProps> = ({
  drivers,
  onUpdateDriver,
  language,
}) => {
  const t = (key: string) => getTranslation(language, key);

  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [aiNotes, setAiNotes] = useState<Record<string, any>>({});

  const handleAiCheckDriver = async (driver: DriverItem) => {
    setCheckingId(driver.id);
    try {
      const res = await fetch('/api/ai/driver-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceType: driver.category,
          vendor: driver.vendor,
          currentDriver: driver.installedVersion,
          hardwareName: driver.deviceName,
        }),
      });

      const json = await res.json();
      if (json.data) {
        setAiNotes((prev) => ({ ...prev, [driver.id]: json.data }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-blue-500 animate-pulse" />
            <span>Automated Windows 11 Driver Integrity Radar</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Monitors WHQL hardware driver releases for NVIDIA, AMD, Intel, and Realtek to eliminate DX12 stuttering and Wi-Fi disconnects.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> 100% Official WHQL Sources
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {drivers.map((driver) => {
          const isUpToDate = driver.status === 'UP_TO_DATE';
          const aiNote = aiNotes[driver.id];

          return (
            <div
              key={driver.id}
              className={`bg-[#111318] rounded-xl border p-5 space-y-4 transition-all ${
                isUpToDate
                  ? 'border-slate-800'
                  : 'border-blue-500/30 bg-gradient-to-r from-[#111318] via-[#111318] to-blue-950/20'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-600/10 border border-blue-600/20 flex items-center justify-center text-blue-400 font-bold">
                    {driver.vendor === 'NVIDIA' ? 'NV' : driver.vendor === 'AMD' ? 'AMD' : 'INT'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                        {driver.category}
                      </span>
                      {driver.whqlCertified && (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          WHQL VERIFIED
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-slate-100 text-sm mt-1">
                      {driver.deviceName}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAiCheckDriver(driver)}
                    disabled={checkingId === driver.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
                  >
                    {checkingId === driver.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    )}
                    <span>AI Check</span>
                  </button>

                  {!isUpToDate ? (
                    <button
                      onClick={() => onUpdateDriver(driver.id)}
                      className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/30 transition flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t('btnUpdateDriver')}</span>
                    </button>
                  ) : (
                    <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Up to Date
                    </span>
                  )}
                </div>
              </div>

              {/* Driver Versions Table */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#0a0b0d] p-3 rounded-lg border border-slate-800 text-xs">
                <div>
                  <div className="text-slate-500 font-medium text-[10px]">Installed Version</div>
                  <div className="font-mono font-bold text-slate-200 mt-0.5">{driver.installedVersion}</div>
                </div>

                <div>
                  <div className="text-slate-500 font-medium text-[10px]">Latest WHQL Version</div>
                  <div className="font-mono font-bold text-blue-400 mt-0.5">{driver.latestVersion}</div>
                </div>

                <div>
                  <div className="text-slate-500 font-medium text-[10px]">Release Date</div>
                  <div className="text-slate-300 mt-0.5">{driver.releaseDate}</div>
                </div>

                <div>
                  <div className="text-slate-500 font-medium text-[10px]">Stability Score</div>
                  <div className="text-emerald-400 font-bold mt-0.5">{driver.stabilityRating}/100</div>
                </div>
              </div>

              {/* Patch Notes */}
              <div className="text-xs text-slate-300 leading-relaxed bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
                <strong className="text-slate-400">Patch Notes:</strong> {driver.patchNotes}
              </div>

              {/* AI Check Box if run */}
              {aiNote && (
                <div className="p-3 bg-blue-950/30 border border-blue-500/30 rounded-lg text-xs space-y-1 animate-fade-in">
                  <div className="text-blue-400 font-bold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> AI Compatibility Verification:
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {aiNote.stabilityNotes}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
