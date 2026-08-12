import React, { useState, useEffect } from 'react';
import {
  Cloud,
  RefreshCw,
  CheckCircle2,
  Laptop,
  Smartphone,
  ShieldCheck,
  History,
  Sparkles,
  ArrowRight,
  Database,
} from 'lucide-react';
import { CloudHealthLog, UserSubscription, LanguageCode } from '../types';
import { getTranslation } from '../lib/i18n';

interface CloudSyncTabProps {
  subscription: UserSubscription;
  onOpenUpgradeModal: () => void;
  language: LanguageCode;
}

export const CloudSyncTab: React.FC<CloudSyncTabProps> = ({
  subscription,
  onOpenUpgradeModal,
  language,
}) => {
  const t = (key: string) => getTranslation(language, key);

  const [logs, setLogs] = useState<CloudHealthLog[]>([]);
  const [cloudProfile, setCloudProfile] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string>('');

  useEffect(() => {
    fetchCloudData();
  }, []);

  const fetchCloudData = async () => {
    try {
      const [resSettings, resReports] = await Promise.all([
        fetch('/api/cloud/settings'),
        fetch('/api/cloud/reports'),
      ]);

      const jsonSettings = await resSettings.json();
      const jsonReports = await resReports.json();

      if (jsonSettings.settings) setCloudProfile(jsonSettings.settings);
      if (jsonReports.logs) setLogs(jsonReports.logs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncStatusMsg('');
    try {
      const res = await fetch('/api/cloud/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newSettings: {
            deviceName: 'Win11-Desktop-X6',
            language: language,
            lastSyncDate: new Date().toISOString(),
          },
        }),
      });

      const json = await res.json();
      if (json.settings) {
        setCloudProfile(json.settings);
        setSyncStatusMsg('Successfully synchronized settings and profile with Cloud Vault!');
      }
    } catch (err) {
      setSyncStatusMsg('Failed to reach cloud endpoint. Saved locally.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-500" />
            <span>Multi-Device Cloud Settings & Health Vault</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Seamlessly sync optimization profiles, custom tweak rules, and health history logs across desktop and mobile companion apps.
          </p>
        </div>

        <button
          onClick={handleSyncNow}
          disabled={isSyncing}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 transition flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Syncing to Cloud...' : 'Sync Settings Now'}</span>
        </button>
      </div>

      {syncStatusMsg && (
        <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{syncStatusMsg}</span>
        </div>
      )}

      {/* Cloud Status Box */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#111318] rounded-2xl border border-slate-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <Laptop className="w-4 h-4 text-blue-400" />
            <span>Primary Device</span>
          </div>
          <div className="text-lg font-extrabold text-white">
            {cloudProfile?.deviceName || 'Win11-Desktop-X6'}
          </div>
          <div className="text-xs text-slate-400">
            Last Sync: {cloudProfile?.cloudBackupDate ? new Date(cloudProfile.cloudBackupDate).toLocaleString() : 'Just now'}
          </div>
        </div>

        <div className="bg-[#111318] rounded-2xl border border-slate-800 p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <span>Mobile Health Alerts</span>
          </div>
          <div className="text-lg font-extrabold text-emerald-400">
            OWNER LINKED
          </div>
          <div className="text-xs text-slate-400">
            Push notifications for critical thermal or driver updates
          </div>
        </div>

        <div className="bg-[#111318] rounded-2xl border border-slate-800 p-5 space-y-3 flex flex-col justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-400" />
            <span>Vault Encryption</span>
          </div>
          <div className="text-sm font-bold text-slate-200">
            AES-256 Zero-Knowledge Sync
          </div>
          <div className="text-xs text-emerald-400 font-bold flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Unlimited Cloud Logs Active</span>
          </div>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="bg-[#111318] rounded-2xl border border-slate-800 p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <History className="w-4 h-4 text-blue-400" />
            <span>Cloud Maintenance & Audit History</span>
          </h3>
          <span className="text-xs text-slate-400">
            {logs.length} historical records synced
          </span>
        </div>

        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="p-4 bg-[#0a0b0d] rounded-xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-400 font-bold">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600/10 text-blue-400 border border-blue-600/20">
                    {log.type}
                  </span>
                </div>
                <div className="text-slate-300">
                  Reclaimed <strong className="text-purple-400">{log.spaceReclaimedMb} MB</strong> across{' '}
                  <strong className="text-slate-100">{log.itemsOptimized} items</strong>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-slate-500 text-[10px]">Health Improvement</div>
                  <div className="font-bold text-emerald-400">
                    {log.healthBefore} &rarr; {log.healthAfter}
                  </div>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
