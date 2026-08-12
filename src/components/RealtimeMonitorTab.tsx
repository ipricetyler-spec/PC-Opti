import React, { useState } from 'react';
import {
  Activity,
  Cpu,
  Zap,
  HardDrive,
  Flame,
  Clock,
  ShieldCheck,
  TrendingUp,
  Sliders,
  Server,
  Play,
  Pause,
} from 'lucide-react';
import { SystemVitals, LanguageCode } from '../types';
import { getTranslation } from '../lib/i18n';

interface RealtimeMonitorTabProps {
  vitals: SystemVitals;
  language: LanguageCode;
}

export const RealtimeMonitorTab: React.FC<RealtimeMonitorTabProps> = ({
  vitals,
  language,
}) => {
  const t = (key: string) => getTranslation(language, key);

  const [autoSchedule, setAutoSchedule] = useState<'daily' | 'weekly' | 'idle'>('weekly');
  const [backgroundMonitoringEnabled, setBackgroundMonitoringEnabled] = useState<boolean>(true);

  // Simulated top background processes
  const processes = [
    { name: 'System Interrupts (Kernel)', cpu: '0.4%', ram: '12 MB', priority: 'Real-time' },
    { name: 'Desktop Window Manager (dwm.exe)', cpu: '2.1%', ram: '148 MB', priority: 'High' },
    { name: 'Rigorset Background Engine', cpu: '0.2%', ram: '34 MB', priority: 'Normal' },
    { name: 'Discord WebHelper', cpu: '4.8%', ram: '420 MB', priority: 'Normal' },
    { name: 'Steam Client WebHelper', cpu: '3.1%', ram: '380 MB', priority: 'Below Normal' },
    { name: 'Windows Search Indexer', cpu: '1.2%', ram: '96 MB', priority: 'Low' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" />
            <span>Real-Time System Telemetry & Background Guard</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Continuous low-overhead background sensor polling (0.2% CPU footprint).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setBackgroundMonitoringEnabled(!backgroundMonitoringEnabled)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
              backgroundMonitoringEnabled
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            {backgroundMonitoringEnabled ? (
              <>
                <Play className="w-3.5 h-3.5 fill-emerald-400" /> Monitoring Active
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" /> Monitoring Paused
              </>
            )}
          </button>
        </div>
      </div>

      {/* Gauges Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <div className="bg-[#111318] rounded-xl p-5 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold uppercase tracking-wider text-slate-500">CPU Usage</span>
            <Cpu className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-mono font-bold text-white">{vitals.cpuUsage}%</div>
            <div className="text-xs text-slate-400 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-400" /> {vitals.cpuTemp}°C
            </div>
          </div>
          <div className="w-full bg-[#0a0b0d] h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${vitals.cpuUsage}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500">16 Cores / 24 Threads Active</div>
        </div>

        {/* GPU */}
        <div className="bg-[#111318] rounded-xl p-5 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold uppercase tracking-wider text-slate-500">GPU Usage</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-mono font-bold text-white">{vitals.gpuUsage}%</div>
            <div className="text-xs text-slate-400 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-rose-400" /> {vitals.gpuTemp}°C
            </div>
          </div>
          <div className="w-full bg-[#0a0b0d] h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-cyan-500 transition-all duration-500"
              style={{ width: `${vitals.gpuUsage}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500">NVIDIA RTX 4070 Ti WHQL</div>
        </div>

        {/* RAM */}
        <div className="bg-[#111318] rounded-xl p-5 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold uppercase tracking-wider text-slate-500">RAM Allocation</span>
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-mono font-bold text-white">{vitals.ramUsage}%</div>
            <div className="text-xs text-emerald-400 font-bold">
              {(100 - vitals.ramUsage).toFixed(0)}% Free
            </div>
          </div>
          <div className="w-full bg-[#0a0b0d] h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${vitals.ramUsage}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500">
            {vitals.ramUsedGb} GB / {vitals.ramTotalGb} GB (Memory Comp On)
          </div>
        </div>

        {/* Disk */}
        <div className="bg-[#111318] rounded-xl p-5 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold uppercase tracking-wider text-slate-500">SSD Disk I/O</span>
            <HardDrive className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-3xl font-mono font-bold text-white">{vitals.diskIoMb} <span className="text-xs text-slate-500">MB/s</span></div>
            <div className="text-xs text-slate-400">{vitals.diskFreeGb} GB Free</div>
          </div>
          <div className="w-full bg-[#0a0b0d] h-2 rounded-full overflow-hidden border border-slate-800">
            <div className="h-full bg-purple-500 w-[22%]" />
          </div>
          <div className="text-[10px] text-slate-500">NVMe SSD TRIM Scheduled</div>
        </div>
      </div>

      {/* Active Processes Table & Auto Schedule Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#111318] rounded-2xl border border-slate-800 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-400" />
              <span>Background Process Footprint</span>
            </h3>
            <span className="text-xs text-slate-400">
              {vitals.activeProcessesCount} active processes
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800/80 font-semibold uppercase text-[10px]">
                  <th className="pb-2">Process Name</th>
                  <th className="pb-2">CPU Load</th>
                  <th className="pb-2">Memory Working Set</th>
                  <th className="pb-2">Thread Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300 font-mono">
                {processes.map((proc, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 font-sans font-medium text-slate-200">{proc.name}</td>
                    <td className="py-2.5 text-blue-400">{proc.cpu}</td>
                    <td className="py-2.5">{proc.ram}</td>
                    <td className="py-2.5 font-sans text-[11px] text-slate-400">{proc.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Schedule Controls */}
        <div className="bg-[#111318] rounded-2xl border border-slate-800 p-6 space-y-4">
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            <span>Automated Maintenance Schedule</span>
          </h3>

          <p className="text-xs text-slate-400 leading-relaxed">
            Configure automatic background execution for 1-Click Care pipeline when system is idling.
          </p>

          <div className="space-y-2 pt-2">
            {[
              { id: 'daily', label: 'Daily (On Idle)', desc: 'Cleans temp cache every 24 hours when idle for 10m' },
              { id: 'weekly', label: 'Weekly (Recommended)', desc: 'Runs full safe optimization once a week' },
              { id: 'idle', label: 'On System Boot', desc: 'Triggers fast memory compression check at login' },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setAutoSchedule(option.id as any)}
                className={`w-full text-left p-3 rounded-xl border text-xs transition ${
                  autoSchedule === option.id
                    ? 'bg-blue-600/15 border-blue-500/40 text-slate-100'
                    : 'bg-[#0a0b0d] border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-bold text-slate-200">{option.label}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
