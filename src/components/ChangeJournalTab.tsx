import React, { useState } from 'react';
import {
  History,
  RotateCcw,
  CheckCircle2,
  ShieldCheck,
  Download,
  AlertCircle,
  Clock,
  Sparkles,
  FileCode,
  Search,
  Zap,
} from 'lucide-react';
import { ChangeJournalEntry, LanguageCode } from '../types';

interface ChangeJournalTabProps {
  journalEntries: ChangeJournalEntry[];
  onRollbackEntry: (id: string) => void;
  onRestoreAll: () => void;
  language: LanguageCode;
  isOwnerMode?: boolean;
}

export const ChangeJournalTab: React.FC<ChangeJournalTabProps> = ({
  journalEntries,
  onRollbackEntry,
  onRestoreAll,
  language,
  isOwnerMode,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const filteredEntries = journalEntries.filter((entry) => {
    const matchesSearch =
      entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.optimizationId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory =
      selectedCategory === 'ALL' || entry.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['ALL', 'Gaming & GPU', 'System Kernel', 'Network', 'Storage & SSD', 'Memory'];

  const handleExportJournal = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(journalEntries, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `Rigorset_Change_Journal_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 relative overflow-hidden backdrop-blur-md">
        <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-blue-400 font-semibold text-sm mb-1">
              <History className="w-4 h-4" />
              <span>Section 40 Auditability Standard</span>
              {isOwnerMode && (
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] px-2 py-0.5 rounded-full font-bold">
                  OWNER UNRESTRICTED AUDIT
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Deterministic Change Journal & Rollback Engine
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Every registry key, service state, or driver parameter adjusted by Rigorset is permanently recorded with exact before-and-after values, verification status, benchmark deltas, and single-click deterministic restoration.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleExportJournal}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Export Audit Log</span>
            </button>
            <button
              onClick={onRestoreAll}
              className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 text-xs font-semibold rounded-lg border border-red-500/30 transition flex items-center gap-2 shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5 text-red-400" />
              <span>Restore All Original States</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter & Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search optimization ID or title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-blue-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <span className="text-xs text-slate-400 whitespace-nowrap mr-1">Filter:</span>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Journal Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-3.5 px-4">Timestamp & ID</th>
                <th className="py-3.5 px-4">Optimization / Target</th>
                <th className="py-3.5 px-4">Previous State</th>
                <th className="py-3.5 px-4">Applied State</th>
                <th className="py-3.5 px-4">Verification & Delta</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-800/30 transition">
                  <td className="py-3.5 px-4">
                    <div className="font-mono text-[11px] text-blue-400 font-semibold">{entry.optimizationId}</div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-slate-600" />
                      <span>{entry.timestamp}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 max-w-xs">
                    <div className="font-semibold text-slate-200 text-xs">{entry.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded font-mono">
                        {entry.category}
                      </span>
                      <span className="bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px] px-1.5 py-0.2 rounded font-semibold">
                        {entry.maturityLevel.replace('_', ' ')}
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                    <span className="bg-slate-950 px-2 py-1 rounded border border-slate-800 block w-fit max-w-[160px] truncate" title={entry.previousState}>
                      {entry.previousState}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-emerald-400">
                    <span className="bg-emerald-950/40 px-2 py-1 rounded border border-emerald-800/40 block w-fit max-w-[160px] truncate" title={entry.resultingState}>
                      {entry.resultingState}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{entry.verificationResult}</span>
                    </div>
                    <div className="text-[10px] text-blue-400 font-mono mt-0.5">
                      {entry.benchmarkDelta}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => onRollbackEntry(entry.id)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition font-medium text-[11px] inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3 h-3 text-amber-400" />
                      <span>Rollback</span>
                    </button>
                  </td>
                </tr>
              ))}

              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No change journal entries match the active search filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
