import React, { useState } from 'react';
import {
  ShieldAlert,
  Zap,
  Power,
  Trash2,
  Sliders,
  Wifi,
  Globe,
  Radio,
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
  Cpu,
  Activity,
  Award,
} from 'lucide-react';
import { StartupApp, LanguageCode } from '../types';

interface DebloatStartupTabProps {
  startupApps: StartupApp[];
  onToggleStartupApp: (id: string) => void;
  language: LanguageCode;
  isOwnerMode?: boolean;
}

export const DebloatStartupTab: React.FC<DebloatStartupTabProps> = ({
  startupApps,
  onToggleStartupApp,
  isOwnerMode,
}) => {
  const [subSection, setSubSection] = useState<'debloat' | 'startup' | 'gpu' | 'network'>('debloat');

  // Debloat Toggles
  const [debloatItems, setDebloatItems] = useState([
    {
      id: 'db-01',
      title: 'Windows 11 Telemetry & DiagTrack Service',
      desc: 'Disables background telemetry data logging and Customer Experience Improvement Program (CEIP).',
      applied: true,
      impact: 'Reduces background disk I/O and network transmission ping spikes.',
    },
    {
      id: 'db-02',
      title: 'Windows Copilot & Bing Search in Start Menu',
      desc: 'Removes AI Copilot web search integrations from local Windows search bar.',
      applied: true,
      impact: 'Frees 180MB RAM and makes Start Menu search instantaneous.',
    },
    {
      id: 'db-03',
      title: 'Xbox Game Bar & Background DVR Recording',
      desc: 'Disables Xbox Game DVR background video recording when third-party capture (ShadowPlay/OBS) is used.',
      applied: false,
      impact: 'Prevents 5-10% GPU encoding overhead in 1440p / 4K gaming.',
    },
    {
      id: 'db-04',
      title: 'Microsoft Consumer Experience & Suggested Apps',
      desc: 'Blocks auto-installing bloatware games (Candy Crush, Disney) on fresh Windows 11 updates.',
      applied: true,
      impact: 'Keeps start menu clean and stops unexpected background downloads.',
    },
  ]);

  // Network Latency Tweak Toggles
  const [networkTweaks, setNetworkTweaks] = useState([
    {
      id: 'net-01',
      title: 'NetworkThrottlingIndex Disable (0xFFFFFFFF)',
      desc: 'Removes Windows network packet throttling cap when non-multimedia applications are running.',
      applied: true,
      impact: 'Locks peak Wi-Fi/Ethernet throughput during competitive gaming matches.',
    },
    {
      id: 'net-02',
      title: 'Nagle Algorithm Delay Bypass (TcpAckFrequency = 1)',
      desc: 'Enforces instant transmission of ACK response packets without waiting for 200ms batch buffer.',
      applied: true,
      impact: 'Saves 5-15ms round-trip ping in Call of Duty, Valorant, and Counter-Strike 2.',
    },
    {
      id: 'net-03',
      title: 'Receive Side Scaling (RSS) & Receive Segment Coalescing (RSC)',
      desc: 'Distributes incoming packet processing evenly across multi-core CPU threads.',
      applied: true,
      impact: 'Eliminates DPC interrupt spikes on 2.5GbE and Wi-Fi 6E network adapters.',
    },
  ]);

  // GPU Subsystem Tuning
  const [hagsEnabled, setHagsEnabled] = useState<boolean>(true);
  const [gpuPowerPlan, setGpuPowerPlan] = useState<'Normal' | 'Prefer Maximum Performance'>('Prefer Maximum Performance');
  const [vramClockOffset, setVramClockOffset] = useState<number>(200);

  const toggleDebloat = (id: string) => {
    setDebloatItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, applied: !item.applied } : item))
    );
  };

  const toggleNetTweak = (id: string) => {
    setNetworkTweaks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, applied: !item.applied } : item))
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-400" />
            <span>OS Debloating, Startup Manager & GPU/Network Subsystem Tuning</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Eliminate micro-stutters by stripping telemetry, restricting heavy startup launchers, and tuning low-level GPU & network adapter interrupt properties.
          </p>
        </div>

        {/* Navigation Pills */}
        <div className="flex flex-wrap items-center gap-2 bg-[#111318] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setSubSection('debloat')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              subSection === 'debloat' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Windows Debloater
          </button>
          <button
            onClick={() => setSubSection('startup')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              subSection === 'startup' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Startup App Manager
          </button>
          <button
            onClick={() => setSubSection('gpu')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              subSection === 'gpu' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            GPU Subsystem & HAGS
          </button>
          <button
            onClick={() => setSubSection('network')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              subSection === 'network' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Network & Ping Latency
          </button>
        </div>
      </div>

      {/* SUB 1: WINDOWS DEBLOATER */}
      {subSection === 'debloat' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {debloatItems.map((item) => (
            <div
              key={item.id}
              className={`bg-[#111318] rounded-2xl border p-5 space-y-3 transition-all ${
                item.applied
                  ? 'border-emerald-500/30 bg-gradient-to-br from-[#111318] to-emerald-950/20'
                  : 'border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-bold text-slate-100 text-sm">{item.title}</h3>
                <button
                  onClick={() => toggleDebloat(item.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    item.applied
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  {item.applied ? 'Debloated' : 'Apply Debloat'}
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">{item.desc}</p>

              <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800 text-xs text-emerald-400 font-medium">
                Expected Impact: {item.impact}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUB 2: STARTUP MANAGER */}
      {subSection === 'startup' && (
        <div className="bg-[#111318] rounded-2xl border border-slate-800 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <Power className="w-4 h-4 text-blue-400" />
              <span>High-Impact Windows Startup Launchers</span>
            </h3>
            <span className="text-xs text-slate-400">
              Disabling high-impact launchers saves ~12.5 seconds on Windows 11 boot time.
            </span>
          </div>

          <div className="space-y-3">
            {startupApps.map((app) => (
              <div
                key={app.id}
                className="p-4 bg-[#0a0b0d] rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100 text-sm">{app.name}</span>
                    <span className="text-[10px] text-slate-500 font-medium">{app.publisher}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        app.impact === 'High'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {app.impact} Impact
                    </span>
                  </div>
                  <div className="text-slate-400 font-mono text-[11px] truncate max-w-md">
                    {app.path}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right text-xs">
                    <div className="text-slate-400 font-mono font-bold">{app.ramUsageMb} MB RAM</div>
                    <div className="text-slate-500 text-[10px]">+{app.bootDelaySec}s Boot Delay</div>
                  </div>

                  <button
                    onClick={() => onToggleStartupApp(app.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                      app.enabled
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {app.enabled ? 'Allowed at Boot' : 'Disabled (Blocked)'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB 3: GPU SUBSYSTEM & HAGS */}
      {subSection === 'gpu' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[#111318] rounded-2xl border border-slate-800 p-6 space-y-4">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>Hardware-Accelerated GPU Scheduling (HAGS)</span>
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed">
              HAGS passes low-level memory scheduling directly to the GPU's onboard RISC co-processor, bypassing CPU driver context switches.
            </p>

            <div className="p-4 bg-[#0a0b0d] rounded-xl border border-slate-800 flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-slate-200">Enforce HAGS Mode (HwSchMode = 2)</div>
                <div className="text-emerald-400 font-semibold mt-0.5">Recommended for RTX 30/40/50 & RX 7000 Series</div>
              </div>
              <input
                type="checkbox"
                checked={hagsEnabled}
                onChange={(e) => setHagsEnabled(e.target.checked)}
                className="w-5 h-5 accent-blue-600 rounded cursor-pointer"
              />
            </div>
          </div>

          <div className="bg-[#111318] rounded-2xl border border-slate-800 p-6 space-y-4">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              <Sliders className="w-4 h-4 text-purple-400" />
              <span>GPU Power Management & VRAM Clocks</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">NVIDIA/AMD Power Management Mode:</label>
                <select
                  value={gpuPowerPlan}
                  onChange={(e) => setGpuPowerPlan(e.target.value as any)}
                  className="w-full bg-[#0a0b0d] border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="Prefer Maximum Performance">Prefer Maximum Performance (Locks P0 State)</option>
                  <option value="Normal">Normal (Adaptive Power Saver)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-slate-300 font-semibold">Safe VRAM Memory Clock Offset:</span>
                  <span className="font-mono text-purple-400 font-bold">+{vramClockOffset} MHz</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="50"
                  value={vramClockOffset}
                  onChange={(e) => setVramClockOffset(Number(e.target.value))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB 4: NETWORK & PING LATENCY */}
      {subSection === 'network' && (
        <div className="grid grid-cols-1 gap-4">
          {networkTweaks.map((tweak) => (
            <div
              key={tweak.id}
              className="bg-[#111318] rounded-2xl border border-slate-800 p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-400" />
                  <span>{tweak.title}</span>
                </h3>

                <button
                  onClick={() => toggleNetTweak(tweak.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    tweak.applied
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  {tweak.applied ? 'Latency Tweak Applied' : 'Apply Network Tweak'}
                </button>
              </div>

              <p className="text-xs text-slate-300">{tweak.desc}</p>
              <div className="p-3 bg-[#0a0b0d] rounded-xl border border-slate-800 text-xs text-blue-400 font-mono">
                Impact: {tweak.impact}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
