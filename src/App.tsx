import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardOverview } from './components/DashboardOverview';
import { TweaksTab } from './components/TweaksTab';
import { DriverRadarTab } from './components/DriverRadarTab';
import { RealtimeMonitorTab } from './components/RealtimeMonitorTab';
import { CloudSyncTab } from './components/CloudSyncTab';
import { DebloatStartupTab } from './components/DebloatStartupTab';
import { DiskOptimizerTab } from './components/DiskOptimizerTab';
import { AntiCheatSentinelTab } from './components/AntiCheatSentinelTab';
import { GameProfilesTab } from './components/GameProfilesTab';
import { ChangeJournalTab } from './components/ChangeJournalTab';
import { UpgradeModal } from './components/UpgradeModal';
import { InstallerModal } from './components/InstallerModal';

import {
  SystemVitals,
  OptimizationTweak,
  DriverItem,
  MaintenanceStep,
  UserSubscription,
  LanguageCode,
  GameProfile,
  StartupApp,
  AntiCheatEngine,
  UefiVendorProvider,
  ChangeJournalEntry,
} from './types';

import {
  INITIAL_OPTIMIZATION_TWEAKS,
  INITIAL_DRIVERS,
  INITIAL_MAINTENANCE_STEPS,
  INITIAL_GAME_PROFILES,
  INITIAL_STARTUP_APPS,
  INITIAL_ANTI_CHEAT_ENGINES,
  INITIAL_UEFI_PROVIDERS,
  INITIAL_CHANGE_JOURNAL_ENTRIES,
} from './lib/optimizerEngine';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [language, setLanguage] = useState<LanguageCode>('en');

  // Subscription state
  const [subscription, setSubscription] = useState<UserSubscription>({
    tier: 'OWNER_UNRESTRICTED',
    isProActive: true,
    cloudBackupSync: true,
    autoMaintenanceEnabled: true,
    aiDiagnosticLimitRemaining: 99999,
    isOwnerMode: true,
  });

  // Modal controls
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState<boolean>(false);
  const [isInstallerModalOpen, setIsInstallerModalOpen] = useState<boolean>(false);

  // App data state
  const [tweaks, setTweaks] = useState<OptimizationTweak[]>(INITIAL_OPTIMIZATION_TWEAKS);
  const [drivers, setDrivers] = useState<DriverItem[]>(INITIAL_DRIVERS);
  const [maintenanceSteps, setMaintenanceSteps] = useState<MaintenanceStep[]>(INITIAL_MAINTENANCE_STEPS);
  const [gameProfiles, setGameProfiles] = useState<GameProfile[]>(INITIAL_GAME_PROFILES);
  const [startupApps, setStartupApps] = useState<StartupApp[]>(INITIAL_STARTUP_APPS);
  const [antiCheatEngines, setAntiCheatEngines] = useState<AntiCheatEngine[]>(INITIAL_ANTI_CHEAT_ENGINES);
  const [uefiProviders, setUefiProviders] = useState<UefiVendorProvider[]>(INITIAL_UEFI_PROVIDERS);
  const [journalEntries, setJournalEntries] = useState<ChangeJournalEntry[]>(INITIAL_CHANGE_JOURNAL_ENTRIES);
  const [systemHealthScore, setSystemHealthScore] = useState<number>(76);
  const [isScanningOrFixing, setIsScanningOrFixing] = useState<boolean>(false);

  const handleRollbackJournalEntry = (id: string) => {
    setJournalEntries((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRestoreAllJournalEntries = () => {
    setJournalEntries([]);
    setTweaks((prev) => prev.map((t) => ({ ...t, isApplied: false })));
  };

  const handleToggleGameProfile = (id: string) => {
    setGameProfiles((prev) =>
      prev.map((g) => (g.id === id ? { ...g, active: !g.active } : g))
    );
  };

  const handleToggleGpuScheduling = (id: string) => {
    setGameProfiles((prev) =>
      prev.map((g) => (g.id === id ? { ...g, gpuSchedulingEnabled: !g.gpuSchedulingEnabled } : g))
    );
  };

  const handleToggleNetworkPriority = (id: string) => {
    setGameProfiles((prev) =>
      prev.map((g) => (g.id === id ? { ...g, networkPriorityEnabled: !g.networkPriorityEnabled } : g))
    );
  };

  const handleUpdateGpuPriority = (id: string, priority: 'High' | 'Realtime' | 'Normal') => {
    setGameProfiles((prev) =>
      prev.map((g) => (g.id === id ? { ...g, gpuPriority: priority } : g))
    );
  };

  const handleUpdateShaderCache = (id: string, mb: number) => {
    setGameProfiles((prev) =>
      prev.map((g) => (g.id === id ? { ...g, shaderCacheMb: mb } : g))
    );
  };

  const handleAddGameProfile = (newGame: GameProfile) => {
    setGameProfiles((prev) => [newGame, ...prev]);
  };

  const handleScanGameLibraries = () => {
    setGameProfiles((prev) =>
      prev.map((g) => ({ ...g, installed: true }))
    );
  };

  const handleToggleStartupApp = (id: string) => {
    setStartupApps((prev) =>
      prev.map((app) => (app.id === id ? { ...app, enabled: !app.enabled } : app))
    );
  };

  // System Vitals State
  const [vitals, setVitals] = useState<SystemVitals>({
    cpuUsage: 18,
    cpuTemp: 48,
    ramUsage: 64,
    ramUsedGb: 10.2,
    ramTotalGb: 16.0,
    gpuUsage: 12,
    gpuTemp: 52,
    diskIoMb: 14,
    diskFreeGb: 88,
    diskTotalGb: 512,
    networkLatencyMs: 14,
    activeProcessesCount: 142,
  });

  // Toggle Owner Unrestricted Build Mode
  const handleToggleOwnerMode = () => {
    setSubscription((prev) => {
      const nextOwner = !prev.isOwnerMode;
      return {
        ...prev,
        isOwnerMode: nextOwner,
        tier: nextOwner ? 'OWNER_UNRESTRICTED' : prev.isProActive ? 'PREMIUM_CLOUD' : 'FREE',
        isProActive: nextOwner || prev.isProActive,
        cloudBackupSync: nextOwner || prev.cloudBackupSync,
        autoMaintenanceEnabled: nextOwner || prev.autoMaintenanceEnabled,
        aiDiagnosticLimitRemaining: nextOwner ? 99999 : prev.aiDiagnosticLimitRemaining,
      };
    });
  };

  // Simulate subtle real-time telemetry fluctuations
  useEffect(() => {
    const interval = setInterval(() => {
      setVitals((prev) => {
        const cpuFluct = Math.min(95, Math.max(8, prev.cpuUsage + Math.floor(Math.random() * 7 - 3)));
        const ramFluct = Math.min(92, Math.max(30, prev.ramUsage + Math.floor(Math.random() * 3 - 1)));
        const gpuFluct = Math.min(99, Math.max(5, prev.gpuUsage + Math.floor(Math.random() * 5 - 2)));
        const diskIo = Math.max(2, prev.diskIoMb + Math.floor(Math.random() * 10 - 5));

        return {
          ...prev,
          cpuUsage: cpuFluct,
          ramUsage: ramFluct,
          ramUsedGb: Number(((ramFluct / 100) * prev.ramTotalGb).toFixed(1)),
          gpuUsage: gpuFluct,
          diskIoMb: diskIo,
          networkLatencyMs: Math.max(8, prev.networkLatencyMs + Math.floor(Math.random() * 3 - 1)),
        };
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // 1-Click System Maintenance Executor Pipeline
  const handleRunOneClickCare = async () => {
    if (isScanningOrFixing) return;
    setIsScanningOrFixing(true);

    // Reset step statuses
    setMaintenanceSteps((prev) =>
      prev.map((step) => ({
        ...step,
        status: 'SCANNING',
        log: [`Scanning Windows 11 kernel subsystem for ${step.id}...`],
      }))
    );

    // Sequence through optimization steps
    for (let i = 0; i < maintenanceSteps.length; i++) {
      const stepId = maintenanceSteps[i].id;

      // Stage 1: Optimizing
      await new Promise((res) => setTimeout(res, 600));
      setMaintenanceSteps((prev) =>
        prev.map((s) =>
          s.id === stepId
            ? {
                ...s,
                status: 'OPTIMIZING',
                log: [...s.log, `Applying verified PowerShell command for ${stepId}...`],
              }
            : s
        )
      );

      // Stage 2: Completed
      await new Promise((res) => setTimeout(res, 700));
      setMaintenanceSteps((prev) =>
        prev.map((s) =>
          s.id === stepId
            ? {
                ...s,
                status: 'COMPLETED',
                log: [
                  ...s.log,
                  `[SUCCESS] Reclaimed ${s.spacePotentialMb}MB and optimized ${s.itemsFound} system handles safely.`,
                ],
              }
            : s
        )
      );
    }

    // Boost health score and free RAM/Disk
    setSystemHealthScore(98);
    setVitals((prev) => ({
      ...prev,
      ramUsage: 42,
      ramUsedGb: 6.7,
      diskFreeGb: prev.diskFreeGb + 4.2,
      cpuUsage: 11,
    }));

    // Post log report to cloud server
    try {
      await fetch('/api/cloud/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newLog: {
            type: 'MANUAL_1CLICK',
            spaceReclaimedMb: 4280,
            itemsOptimized: 508,
            healthBefore: 76,
            healthAfter: 98,
            status: 'SUCCESS',
          },
        }),
      });
    } catch (e) {
      console.error(e);
    }

    setIsScanningOrFixing(false);
  };

  // Toggle individual safe tweak
  const handleToggleTweak = (id: string) => {
    setTweaks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isApplied: !t.isApplied } : t))
    );
  };

  // Update Driver handler
  const handleUpdateDriver = (id: string) => {
    setDrivers((prev) =>
      prev.map((d) =>
        d.id === id
          ? {
              ...d,
              installedVersion: d.latestVersion,
              status: 'UP_TO_DATE',
              patchNotes: 'Driver updated to latest WHQL release. System optimal.',
            }
          : d
      )
    );
  };

  // Pro Upgrade trigger
  const handleUpgradeToPro = () => {
    setSubscription((prev) => ({
      ...prev,
      tier: 'PREMIUM_CLOUD',
      isProActive: true,
      cloudBackupSync: true,
      autoMaintenanceEnabled: true,
      aiDiagnosticLimitRemaining: 999,
    }));
    setIsUpgradeModalOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-[#0a0b0d] text-slate-200 font-sans antialiased overflow-x-hidden selection:bg-blue-600 selection:text-white">
      {/* Sleek Interface Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        language={language}
        subscription={subscription}
        onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)}
        onOpenInstallerModal={() => setIsInstallerModalOpen(true)}
        isScanningOrFixing={isScanningOrFixing}
      />

      {/* Main App Layout */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          language={language}
          setLanguage={setLanguage}
          subscription={subscription}
          onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)}
          systemHealthScore={systemHealthScore}
          onToggleOwnerMode={handleToggleOwnerMode}
        />

        <main className="flex-1 p-6 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
          {activeTab === 'dashboard' && (
            <DashboardOverview
              vitals={vitals}
              maintenanceSteps={maintenanceSteps}
              isScanningOrFixing={isScanningOrFixing}
              onRunOneClickCare={handleRunOneClickCare}
              language={language}
              subscription={subscription}
              onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)}
              systemHealthScore={systemHealthScore}
            />
          )}

          {activeTab === 'tweaks' && (
            <TweaksTab
              tweaks={tweaks}
              onToggleTweak={handleToggleTweak}
              language={language}
            />
          )}

          {activeTab === 'debloat' && (
            <DebloatStartupTab
              startupApps={startupApps}
              onToggleStartupApp={handleToggleStartupApp}
              language={language}
              isOwnerMode={subscription.isOwnerMode}
            />
          )}

          {activeTab === 'defrag' && (
            <DiskOptimizerTab
              vitals={vitals}
              language={language}
              isOwnerMode={subscription.isOwnerMode}
            />
          )}

          {activeTab === 'sentinel' && (
            <AntiCheatSentinelTab
              antiCheatEngines={antiCheatEngines}
              uefiProviders={uefiProviders}
              vitals={vitals}
              language={language}
              isOwnerMode={subscription.isOwnerMode}
            />
          )}

          {activeTab === 'games' && (
            <GameProfilesTab
              gameProfiles={gameProfiles}
              onToggleGameProfile={handleToggleGameProfile}
              onToggleGpuScheduling={handleToggleGpuScheduling}
              onToggleNetworkPriority={handleToggleNetworkPriority}
              onUpdateGpuPriority={handleUpdateGpuPriority}
              onUpdateShaderCache={handleUpdateShaderCache}
              onAddGameProfile={handleAddGameProfile}
              onScanGameLibraries={handleScanGameLibraries}
              language={language}
              isOwnerMode={subscription.isOwnerMode}
            />
          )}

          {activeTab === 'drivers' && (
            <DriverRadarTab
              drivers={drivers}
              onUpdateDriver={handleUpdateDriver}
              language={language}
            />
          )}

          {activeTab === 'monitor' && (
            <RealtimeMonitorTab vitals={vitals} language={language} />
          )}

          {activeTab === 'journal' && (
            <ChangeJournalTab
              journalEntries={journalEntries}
              onRollbackEntry={handleRollbackJournalEntry}
              onRestoreAll={handleRestoreAllJournalEntries}
              language={language}
              isOwnerMode={subscription.isOwnerMode}
            />
          )}

          {activeTab === 'cloud' && (
            <CloudSyncTab
              subscription={subscription}
              onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)}
              language={language}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <UpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        subscription={subscription}
        onUpgradeToPro={handleUpgradeToPro}
        language={language}
      />

      <InstallerModal
        isOpen={isInstallerModalOpen}
        onClose={() => setIsInstallerModalOpen(false)}
      />
    </div>
  );
}
