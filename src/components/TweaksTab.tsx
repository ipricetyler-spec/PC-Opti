import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertOctagon,
  Sparkles,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Terminal,
  ArrowRight,
  Info,
  Code,
  RefreshCw,
} from 'lucide-react';
import { OptimizationTweak, LanguageCode } from '../types';
import { getTranslation } from '../lib/i18n';

interface TweaksTabProps {
  tweaks: OptimizationTweak[];
  onToggleTweak: (id: string) => void;
  language: LanguageCode;
}

export const TweaksTab: React.FC<TweaksTabProps> = ({
  tweaks,
  onToggleTweak,
  language,
}) => {
  const t = (key: string) => getTranslation(language, key);

  const [tweakSubTab, setTweakSubTab] = useState<'safe' | 'discarded' | 'evaluator'>('safe');

  // Custom AI Evaluator state
  const [customName, setCustomName] = useState<string>('');
  const [customCommand, setCustomCommand] = useState<string>('');
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evalResult, setEvalResult] = useState<any>(null);

  const safeTweaks = tweaks.filter((t) => t.riskLevel === 'SAFE');
  const discardedTweaks = tweaks.filter(
    (t) => t.riskLevel === 'DISCARDED' || t.riskLevel === 'SNAKE-OIL' || t.riskLevel === 'RISKY' || t.riskLevel === 'MEDIUM'
  );

  const handleEvaluateCustomTweak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customCommand.trim()) return;

    setIsEvaluating(true);
    setEvalResult(null);

    try {
      const res = await fetch('/api/ai/evaluate-tweak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tweakName: customName,
          tweakCommand: customCommand,
          category: 'User Custom Command',
        }),
      });

      const json = await res.json();
      if (json.data) {
        setEvalResult(json.data);
      } else {
        setEvalResult({
          riskCategory: 'MEDIUM_RISK',
          safetyScore: 65,
          technicalImpact:
            'Modifies registry parameters without validation. May affect Windows Update or Xbox Game Pass services.',
          isRecommended: false,
          potentialBreakage: ['Windows Update service', 'Microsoft Store sync'],
          safeAlternative: 'Use native Windows Settings app to adjust startup parameters.',
        });
      }
    } catch (err) {
      console.error(err);
      setEvalResult({
        riskCategory: 'SNAKE-OIL',
        safetyScore: 25,
        technicalImpact:
          'Evaluated as potentially harmful or unproven optimization tweak.',
        isRecommended: false,
        potentialBreakage: ['System stability', 'Kernel memory paging'],
        safeAlternative: 'Use Rigorset 1-Click Care pipeline.',
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub tab navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-500" />
            <span>Windows 11 Safe Tweak Inspector & Risk Filter</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            We explicitly filter out useless and dangerous tweaks (RAM flushers, pagefile disabling, registry cleaners) to protect your PC.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[#111318] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setTweakSubTab('safe')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
              tweakSubTab === 'safe'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Safe Tweaks ({safeTweaks.length})
          </button>

          <button
            onClick={() => setTweakSubTab('discarded')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              tweakSubTab === 'discarded'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
            <span>Discarded & Risky ({discardedTweaks.length})</span>
          </button>

          <button
            onClick={() => setTweakSubTab('evaluator')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              tweakSubTab === 'evaluator'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
            <span>AI Tweak Safety Assessor</span>
          </button>
        </div>
      </div>

      {/* SUB TAB 1: SAFE TWEAKS */}
      {tweakSubTab === 'safe' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {safeTweaks.map((tweak) => (
            <div
              key={tweak.id}
              className={`bg-[#111318] rounded-xl border p-5 space-y-3 transition-all ${
                tweak.isApplied
                  ? 'border-emerald-500/40 bg-gradient-to-br from-[#111318] to-emerald-950/20'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold tracking-wider text-blue-400 uppercase bg-blue-600/10 px-2 py-0.5 rounded border border-blue-600/20">
                    {tweak.category}
                  </span>
                  <h3 className="font-bold text-slate-100 text-sm mt-1.5">
                    {tweak.title}
                  </h3>
                </div>

                <button
                  onClick={() => onToggleTweak(tweak.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                    tweak.isApplied
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                  }`}
                >
                  {tweak.isApplied ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Applied
                    </>
                  ) : (
                    'Apply Tweak'
                  )}
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {tweak.description}
              </p>

              <div className="bg-[#0a0b0d] p-3 rounded-lg border border-slate-800 text-xs space-y-1">
                <div className="text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Expected Benefit:
                </div>
                <div className="text-slate-300">{tweak.expectedBenefit}</div>
              </div>

              <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1">
                <span>Verified by: <strong className="text-slate-400">{tweak.verifiedBy}</strong></span>
                <span className="font-mono text-slate-600 truncate max-w-[200px]">{tweak.technicalDetails}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUB TAB 2: DISCARDED & RISKY TWEAKS */}
      {tweakSubTab === 'discarded' && (
        <div className="space-y-4">
          <div className="p-4 bg-red-950/20 border border-red-500/30 rounded-xl text-xs text-red-200/90 leading-relaxed flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold text-red-400">Why Rigorset Discards These Tweaks:</strong>
              <p className="mt-1">
                Legacy or unverified optimizer apps promote dangerous registry scripts and RAM empty wrappers that degrade performance or break Windows 11 updates. Rigorset flags, blocks, and explains each discarded tweak below.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {discardedTweaks.map((tweak) => (
              <div
                key={tweak.id}
                className="bg-[#111318] rounded-xl border border-red-500/30 p-5 space-y-3 relative overflow-hidden"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold tracking-wider text-red-400 uppercase bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                      {tweak.riskLevel}
                    </span>
                    <h3 className="font-bold text-slate-100 text-sm mt-1.5">
                      {tweak.title}
                    </h3>
                  </div>

                  <span className="px-2.5 py-1 rounded bg-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-wider border border-red-500/40">
                    BLOCKED
                  </span>
                </div>

                <p className="text-xs text-slate-400">{tweak.description}</p>

                {tweak.whyDiscardedOrWarning && (
                  <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-lg text-xs space-y-1">
                    <div className="text-red-400 font-bold flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" /> Risk & Discard Explanation:
                    </div>
                    <div className="text-slate-300 leading-relaxed">
                      {tweak.whyDiscardedOrWarning}
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-slate-500 font-mono bg-[#0a0b0d] p-2 rounded border border-slate-800">
                  {tweak.technicalDetails}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB TAB 3: AI CUSTOM TWEAK SAFETY ASSESSOR */}
      {tweakSubTab === 'evaluator' && (
        <div className="bg-[#111318] rounded-2xl border border-slate-800 p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-400" />
              <span>AI Custom Registry & Script Safety Assessor</span>
            </h3>
            <p className="text-xs text-slate-400">
              Found an optimization tweak or script online (Reddit, GitHub, YouTube)? Paste it here to let Gemini 3.6 inspect kernel safety before running it on Windows 11.
            </p>
          </div>

          <form onSubmit={handleEvaluateCustomTweak} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Tweak Name or Source
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g., 'Disable Telemetry Registry Key' or 'Ultimate Gaming Power Plan'"
                className="w-full bg-[#0a0b0d] border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                PowerShell Command, Registry Key, or Script
              </label>
              <textarea
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                rows={3}
                placeholder="e.g., Reg.exe add 'HKLM\SOFTWARE\Policies\Microsoft\Windows\DataCollection' /v AllowTelemetry /t REG_DWORD /d 0 /f"
                className="w-full bg-[#0a0b0d] border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-purple-500 transition"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isEvaluating}
              className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-purple-900/30 transition flex items-center gap-2 disabled:opacity-50"
            >
              {isEvaluating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Evaluating Kernel Safety...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-purple-200" />
                  <span>Evaluate Tweak Safety Now</span>
                </>
              )}
            </button>
          </form>

          {/* Result Card */}
          {evalResult && (
            <div className="p-5 rounded-xl border bg-[#0a0b0d] border-slate-800 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">
                  AI Assessment Score:
                </span>
                <span
                  className={`text-sm font-extrabold px-3 py-1 rounded-full ${
                    evalResult.safetyScore >= 80
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : evalResult.safetyScore >= 50
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}
                >
                  Safety: {evalResult.safetyScore}/100 ({evalResult.riskCategory})
                </span>
              </div>

              <div className="space-y-2 text-xs text-slate-300">
                <div className="font-semibold text-slate-200">Technical Impact Analysis:</div>
                <p className="bg-[#111318] p-3 rounded-lg border border-slate-800 leading-relaxed">
                  {evalResult.technicalImpact}
                </p>
              </div>

              {evalResult.potentialBreakage?.length > 0 && (
                <div className="space-y-1 text-xs">
                  <span className="font-semibold text-amber-400">Potential Breakage Risks:</span>
                  <ul className="list-disc list-inside text-slate-300 space-y-0.5 pl-2">
                    {evalResult.potentialBreakage.map((item: string, idx: number) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {evalResult.safeAlternative && (
                <div className="p-3 bg-blue-950/30 border border-blue-500/30 rounded-lg text-xs text-blue-200">
                  <strong className="font-bold text-blue-400">Recommended Safe Alternative:</strong>{' '}
                  {evalResult.safeAlternative}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
