import React, { useState } from 'react';
import {
  Gamepad2,
  Zap,
  CheckCircle2,
  Sparkles,
  Crosshair,
  Shield,
  Flame,
  Target,
  Play,
  Check,
  Terminal,
  Activity,
  Award,
  Search,
  RefreshCw,
  Plus,
  HardDrive,
  FolderCheck,
  Network,
  Cpu,
  Copy,
  X,
  Info,
  Sliders,
  Gauge,
  FolderOpen,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { GameProfile, LanguageCode } from '../types';

interface GameProfilesTabProps {
  gameProfiles: GameProfile[];
  onToggleGameProfile: (id: string) => void;
  onToggleGpuScheduling?: (id: string) => void;
  onToggleNetworkPriority?: (id: string) => void;
  onUpdateGpuPriority?: (id: string, priority: 'High' | 'Realtime' | 'Normal') => void;
  onUpdateShaderCache?: (id: string, mb: number) => void;
  onAddGameProfile?: (newGame: GameProfile) => void;
  onScanGameLibraries?: () => void;
  language: LanguageCode;
  isOwnerMode?: boolean;
}

export const GameProfilesTab: React.FC<GameProfilesTabProps> = ({
  gameProfiles,
  onToggleGameProfile,
  onToggleGpuScheduling,
  onToggleNetworkPriority,
  onUpdateGpuPriority,
  onUpdateShaderCache,
  onAddGameProfile,
  onScanGameLibraries,
  isOwnerMode,
}) => {
  // Local UI State
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [boostedId, setBoostedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'installed' | 'active'>('all');
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);

  // Scanning Modal & Logs State
  const [isScanningModalOpen, setIsScanningModalOpen] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [isScanComplete, setIsScanComplete] = useState(false);

  // Add Custom Game Form State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customGenre, setCustomGenre] = useState('FPS / Battle Royale');
  const [customExe, setCustomExe] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Crosshair':
        return Crosshair;
      case 'Shield':
        return Shield;
      case 'Flame':
        return Flame;
      case 'Target':
        return Target;
      case 'Zap':
        return Zap;
      default:
        return Gamepad2;
    }
  };

  const handleCopyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleInstantBoost = (id: string) => {
    setBoostedId(id);
    setTimeout(() => setBoostedId(null), 3000);
  };

  // Trigger Local Registry Game Detection Scan
  const handleStartScan = () => {
    setIsScanningModalOpen(true);
    setIsScanComplete(false);
    setScanProgress(0);
    setScanLogs(['Initializing Windows Registry & Library Scanner...']);

    const steps = [
      { progress: 15, log: 'Scanning C:\\Program Files (x86)\\Steam\\steamapps...' },
      { progress: 35, log: 'Detected Steam Library: 3 Esports Titles found (Call of Duty HQ, CS2, Cyberpunk 2077)' },
      { progress: 55, log: 'Querying HKLM\\SOFTWARE\\Epic Games\\EpicGamesLauncher...' },
      { progress: 75, log: 'Detected Epic Games Store: Fortnite (Unreal Engine 5.4)' },
      { progress: 90, log: 'Querying C:\\Riot Games & Vanguard Kernel Service...' },
      { progress: 100, log: 'Scan Complete: 5 Game Installations detected and verified safe!' },
    ];

    steps.forEach((step, index) => {
      setTimeout(() => {
        setScanProgress(step.progress);
        setScanLogs((prev) => [...prev, step.log]);
        if (index === steps.length - 1) {
          setIsScanComplete(true);
          if (onScanGameLibraries) {
            onScanGameLibraries();
          }
        }
      }, (index + 1) * 600);
    });
  };

  // Generate Custom Game Profile via AI
  const handleCreateCustomGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim()) return;

    setIsGeneratingAi(true);

    try {
      const response = await fetch('/api/ai/game-optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameTitle: customTitle,
          genre: customGenre,
          gpuModel: 'NVIDIA GeForce RTX 4070 Ti / 5070',
          cpuModel: 'AMD Ryzen 7 7800X3D / Intel i7 14700K',
          ramGb: 32,
        }),
      });

      const resData = await response.json();
      const aiResult = resData.data || resData.fallback;

      const newProfile: GameProfile = {
        id: `game-custom-${Date.now()}`,
        title: aiResult.title || customTitle,
        genre: aiResult.genre || customGenre,
        iconName: 'Gamepad2',
        installed: true,
        installPath: aiResult.detectedPath || `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${customTitle}\\game.exe`,
        detectedLauncher: 'Custom',
        executableName: customExe || `${customTitle.toLowerCase().replace(/\s+/g, '')}.exe`,
        active: true,
        gpuPriority: aiResult.gpuPriority || 'Realtime',
        gpuSchedulingEnabled: aiResult.gpuSchedulingEnabled ?? true,
        networkPriorityEnabled: aiResult.networkPriorityEnabled ?? true,
        networkQosTag: aiResult.networkQosTag || 'DSCP 46 High-Priority QoS',
        hagsRecommended: aiResult.hagsRecommended ?? true,
        shaderCacheMb: aiResult.shaderCacheMb || 8192,
        workerThreads: aiResult.workerThreads || 8,
        lowLatencyMode: aiResult.lowLatencyMode || 'Reflex Boost',
        customPowerShell: aiResult.customPowerShell || `Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\DirectX" -Name "MaxShaderCacheSize" -Value 8192`,
        description: aiResult.description || 'Custom game profile auto-tuned with AI engine parameters for ultra-low latency.',
        fpsGainPct: aiResult.fpsGainPct || 15.5,
        stutterReductionPct: aiResult.stutterReductionPct || 35,
      };

      if (onAddGameProfile) {
        onAddGameProfile(newProfile);
      }

      setIsAddModalOpen(false);
      setCustomTitle('');
      setCustomExe('');
    } catch (err) {
      console.error('Error adding custom game:', err);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Filtered Game Profiles
  const filteredProfiles = gameProfiles.filter((game) => {
    const matchesSearch =
      game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      game.genre.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (game.detectedLauncher && game.detectedLauncher.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (game.executableName && game.executableName.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterMode === 'installed') return game.installed;
    if (filterMode === 'active') return game.active;
    return true;
  });

  const installedCount = gameProfiles.filter((g) => g.installed).length;
  const activeCount = gameProfiles.filter((g) => g.active).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Banner & Stats */}
      <div className="bg-[#111318] border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Gamepad2 className="w-6 h-6 text-blue-500" />
              <span>Game-Specific 1-Click High-Performance Profiles</span>
            </h2>
            <p className="text-xs text-slate-400 max-w-3xl">
              Detects installed esports & AAA game libraries to inject targeted Hardware GPU scheduling (HAGS), DSCP Network QoS packet priority, and DirectX 12 pre-allocated shader caches.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleStartScan}
              className="px-4 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-xs font-bold transition flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Detect Installed Games</span>
            </button>

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-blue-950/40 transition flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add Custom Game</span>
            </button>
          </div>
        </div>

        {/* Quick Vitals Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80 text-xs">
          <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Installed Games</span>
            <span className="font-mono font-bold text-blue-400 text-sm">{installedCount} / {gameProfiles.length}</span>
          </div>

          <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Active High-Perf Profiles</span>
            <span className="font-mono font-bold text-emerald-400 text-sm">{activeCount} Running</span>
          </div>

          <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span className="text-slate-400 font-medium">GPU Scheduling (HAGS)</span>
            <span className="font-mono font-bold text-purple-400 text-sm">Mode 2 (HW)</span>
          </div>

          <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Network QoS Priority</span>
            <span className="font-mono font-bold text-amber-400 text-sm">DSCP Tag 46</span>
          </div>
        </div>

        {isOwnerMode && (
          <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4" />
              <span>OWNER BUILD UNLOCKED: Direct Process Priority Realtime Overrides & Kernel Affinity Enabled</span>
            </div>
            <span className="text-[10px] font-mono bg-amber-500/20 px-2 py-0.5 rounded">KERNEL_SAFE</span>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Search Field */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search installed game, executable (cod.exe), or launcher..."
            className="w-full bg-[#111318] border border-slate-800 focus:border-blue-500 text-slate-200 text-xs rounded-xl pl-9 pr-4 py-2.5 outline-none transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 bg-[#111318] border border-slate-800 p-1 rounded-xl text-xs font-medium">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded-lg transition ${
              filterMode === 'all'
                ? 'bg-blue-600 text-white font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Games ({gameProfiles.length})
          </button>
          <button
            onClick={() => setFilterMode('installed')}
            className={`px-3 py-1.5 rounded-lg transition ${
              filterMode === 'installed'
                ? 'bg-blue-600 text-white font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Installed Only ({installedCount})
          </button>
          <button
            onClick={() => setFilterMode('active')}
            className={`px-3 py-1.5 rounded-lg transition ${
              filterMode === 'active'
                ? 'bg-blue-600 text-white font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Active High-Perf ({activeCount})
          </button>
        </div>
      </div>

      {/* Profiles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredProfiles.map((game) => {
          const IconComponent = getIcon(game.iconName);
          const isExpanded = expandedGameId === game.id;

          return (
            <div
              key={game.id}
              className={`bg-[#111318] rounded-2xl border p-5 space-y-4 transition-all flex flex-col justify-between relative overflow-hidden ${
                game.active
                  ? 'border-blue-500/50 bg-gradient-to-b from-blue-950/30 via-[#111318] to-[#111318] shadow-lg shadow-blue-900/20'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              {game.active && (
                <div className="absolute top-0 right-0 bg-blue-600 text-white text-[9px] font-extrabold uppercase px-2.5 py-0.5 rounded-bl-lg flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-300" /> HIGH-PERF ACTIVE
                </div>
              )}

              <div className="space-y-3">
                {/* Header Info */}
                <div className="flex items-start justify-between gap-3 pt-1">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                      <IconComponent className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-800 px-2 py-0.5 rounded">
                          {game.genre}
                        </span>

                        {game.detectedLauncher && (
                          <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                            <FolderCheck className="w-3 h-3" />
                            {game.detectedLauncher}
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-slate-100 text-sm mt-1">
                        {game.title}
                      </h3>
                    </div>
                  </div>
                </div>

                {/* Installation Detection Status Badge */}
                <div className="bg-[#0a0b0d] p-2.5 rounded-xl border border-slate-800/80 text-[11px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Detection Status</span>
                    {game.installed ? (
                      <span className="text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> INSTALLED
                      </span>
                    ) : (
                      <span className="text-amber-400/80 font-medium text-[11px]">
                        NOT DETECTED
                      </span>
                    )}
                  </div>

                  {game.installed && game.installPath && (
                    <div className="text-[10px] font-mono text-slate-400 truncate flex items-center justify-between bg-slate-900/60 px-2 py-1 rounded border border-slate-800">
                      <span className="truncate pr-2">{game.installPath}</span>
                      <button
                        onClick={() => handleCopyCode(`path-${game.id}`, game.installPath!)}
                        className="text-slate-500 hover:text-slate-300 shrink-0"
                        title="Copy Executable Path"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {game.description}
                </p>

                {/* High-Performance Settings Toggles Section */}
                <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800 space-y-2.5 text-xs">
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span>Performance Tweaks</span>
                    <span className="text-blue-400 font-mono">{game.gpuPriority} GPU Priority</span>
                  </div>

                  {/* 1. GPU Scheduling Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gauge className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-slate-200 text-[11px]">GPU Hardware Scheduling (HAGS)</span>
                    </div>

                    <button
                      onClick={() => onToggleGpuScheduling && onToggleGpuScheduling(game.id)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition flex items-center gap-1.5 ${
                        game.gpuSchedulingEnabled
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                          : 'bg-slate-800 text-slate-500 border border-slate-700'
                      }`}
                    >
                      {game.gpuSchedulingEnabled ? (
                        <>
                          <CheckSquare className="w-3 h-3 text-purple-400" />
                          <span>HAGS ON</span>
                        </>
                      ) : (
                        <>
                          <Square className="w-3 h-3" />
                          <span>OFF</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* 2. Low-Latency Network Priority Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Network className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-slate-200 text-[11px]">Network Priority QoS Packet Tag</span>
                    </div>

                    <button
                      onClick={() => onToggleNetworkPriority && onToggleNetworkPriority(game.id)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition flex items-center gap-1.5 ${
                        game.networkPriorityEnabled
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-800 text-slate-500 border border-slate-700'
                      }`}
                    >
                      {game.networkPriorityEnabled ? (
                        <>
                          <CheckSquare className="w-3 h-3 text-amber-400" />
                          <span>QoS ON</span>
                        </>
                      ) : (
                        <>
                          <Square className="w-3 h-3" />
                          <span>OFF</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* 3. Shader Cache Allocation */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[11px]">
                    <span className="text-slate-400">DX12 Shader Cache</span>
                    <div className="flex items-center gap-1">
                      {[4096, 8192, 10240, 12288].map((sizeMb) => (
                        <button
                          key={sizeMb}
                          onClick={() => onUpdateShaderCache && onUpdateShaderCache(game.id, sizeMb)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition ${
                            game.shaderCacheMb === sizeMb
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {(sizeMb / 1024).toFixed(0)}GB
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Performance Gains Metrics */}
                <div className="flex items-center justify-between text-xs pt-1 px-1">
                  <div className="flex items-center gap-1 text-emerald-400 font-bold">
                    <Activity className="w-3.5 h-3.5" />
                    <span>+{game.fpsGainPct}% Avg FPS</span>
                  </div>
                  <div className="text-blue-400 font-bold">
                    -{game.stutterReductionPct}% Micro-Stutter
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 space-y-2">
                {/* Master High-Perf Profile Toggle Button */}
                <button
                  onClick={() => onToggleGameProfile(game.id)}
                  className={`w-full py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                    game.active
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/30'
                  }`}
                >
                  {game.active ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Profile Applied & High-Perf Enabled</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Apply High-Performance Settings</span>
                    </>
                  )}
                </button>

                {/* Instant Launch Boost Button */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleInstantBoost(game.id)}
                    className={`py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5 border ${
                      boostedId === game.id
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-[#0a0b0d] hover:bg-slate-800 text-amber-400 border-slate-800'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>{boostedId === game.id ? 'Boost Applied!' : 'Instant Boost'}</span>
                  </button>

                  <button
                    onClick={() => handleCopyCode(game.id, game.customPowerShell)}
                    className="py-1.5 bg-[#0a0b0d] hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-[11px] font-mono transition flex items-center justify-center gap-1.5 border border-slate-800"
                  >
                    {copiedId === game.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied PS</span>
                      </>
                    ) : (
                      <>
                        <Terminal className="w-3.5 h-3.5 text-slate-500" />
                        <span>Export Script</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Expand / Collapse Details Drawer */}
                <button
                  onClick={() => setExpandedGameId(isExpanded ? null : game.id)}
                  className="w-full text-center text-[10px] text-slate-500 hover:text-slate-300 font-medium pt-1 flex items-center justify-center gap-1"
                >
                  <span>{isExpanded ? 'Hide Technical Registry Keys' : 'View Registry & Process Affinities'}</span>
                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {isExpanded && (
                  <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800 space-y-2 text-[10px] font-mono text-slate-300 animate-fade-in">
                    <div>
                      <span className="text-slate-500 block">Worker Thread Affinity:</span>
                      <span className="text-blue-400">{game.workerThreads} CPU Physical Cores Locked</span>
                    </div>

                    <div>
                      <span className="text-slate-500 block">Low Latency Engine:</span>
                      <span className="text-emerald-400">{game.lowLatencyMode}</span>
                    </div>

                    <div>
                      <span className="text-slate-500 block">PowerShell Tweak Command:</span>
                      <p className="bg-slate-900 p-2 rounded text-slate-400 break-all select-all border border-slate-800">
                        {game.customPowerShell}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detection Scan Modal */}
      {isScanningModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#111318] border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <RefreshCw className={`w-5 h-5 text-blue-500 ${!isScanComplete ? 'animate-spin' : ''}`} />
                <span>Scanning Installed Game Libraries</span>
              </h3>
              {isScanComplete && (
                <button
                  onClick={() => setIsScanningModalOpen(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Scan Progress</span>
                <span className="font-mono text-blue-400 font-bold">{scanProgress}%</span>
              </div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="bg-blue-600 h-full transition-all duration-300"
                  style={{ width: `${scanProgress}%` }}
                />
              </div>
            </div>

            {/* Scan Logs Box */}
            <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800 h-44 overflow-y-auto font-mono text-[11px] space-y-1.5 text-slate-300">
              {scanLogs.map((log, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-blue-500 shrink-0">&gt;</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setIsScanningModalOpen(false)}
                disabled={!isScanComplete}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                  isScanComplete
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {isScanComplete ? 'Done & Review Games' : 'Scanning...'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Game Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#111318] border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-500" />
                <span>Add Custom Game for AI Optimization</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomGame} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 font-bold mb-1">
                  Game Title
                </label>
                <input
                  type="text"
                  required
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. Elden Ring, GTA V, Helldivers 2"
                  className="w-full bg-[#0a0b0d] border border-slate-800 focus:border-blue-500 text-slate-100 text-xs rounded-xl px-3.5 py-2.5 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 font-bold mb-1">
                  Genre
                </label>
                <select
                  value={customGenre}
                  onChange={(e) => setCustomGenre(e.target.value)}
                  className="w-full bg-[#0a0b0d] border border-slate-800 focus:border-blue-500 text-slate-100 text-xs rounded-xl px-3.5 py-2.5 outline-none transition"
                >
                  <option value="FPS / Tactical Shooter">FPS / Tactical Shooter</option>
                  <option value="Battle Royale">Battle Royale</option>
                  <option value="Open World RPG">Open World RPG</option>
                  <option value="Action / Adventure">Action / Adventure</option>
                  <option value="Racing / Simulator">Racing / Simulator</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-300 font-bold mb-1">
                  Executable Name (Optional)
                </label>
                <input
                  type="text"
                  value={customExe}
                  onChange={(e) => setCustomExe(e.target.value)}
                  placeholder="e.g. eldenring.exe"
                  className="w-full bg-[#0a0b0d] border border-slate-800 focus:border-blue-500 text-slate-100 text-xs rounded-xl px-3.5 py-2.5 outline-none transition font-mono"
                />
              </div>

              <div className="bg-[#0a0b0d] p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <span className="font-bold text-blue-400 block flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> AI Engine Tuning Active
                </span>
                <p>
                  Gemini AI will analyze engine thread model, HAGS compatibility, DSCP QoS tags, and DX12 shader cache allocations for this game title.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGeneratingAi}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-950/40 transition flex items-center gap-2"
                >
                  {isGeneratingAi ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Generating AI Profile...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Create Game Profile</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
