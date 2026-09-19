// PARKED: unreachable historical prototype; excluded from the active build.
import { ArrowRight, BadgeCheck, CalendarDays, CircleDollarSign, Gift, KeyRound, ShieldCheck, Sparkles, ExternalLink, CircleHelp, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ConsumerLicenseState } from '../types';
import {
  CONSUMER_CHECKOUT_OFFERS,
  CONSUMER_CHECKOUT_CONFIG,
  CONSUMER_MONETIZATION_NOTES,
  CONSUMER_PREMIUM_OFFERS,
  isConsumerPremiumActive,
} from '../lib/consumerMonetization';

interface ConsumerUpgradeCenterProps {
  profile: 'public' | 'consumer-premium' | 'owner';
  license?: ConsumerLicenseState;
  isBusy: boolean;
  status: string | null;
  error: string | null;
  onStartTrial: (days: 7 | 14) => Promise<void>;
  onRedeemLicense: (code: string) => Promise<void>;
  onRefreshRuntimeProfile: () => Promise<void>;
}

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return 'No expiry recorded';
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return 'Unverified expiry date';
  return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString()}`;
}

function isValidPublicUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export function ConsumerUpgradeCenter({
  profile,
  license,
  isBusy,
  status,
  error,
  onStartTrial,
  onRedeemLicense,
  onRefreshRuntimeProfile,
}: ConsumerUpgradeCenterProps) {
  const [redeemCode, setRedeemCode] = useState('');
  const isPremium = isConsumerPremiumActive(profile, license);
  const isOwner = profile === 'owner';
  const expiryText = useMemo(() => formatExpiry(license?.expiresAt ?? null), [license?.expiresAt]);
  const trialOrActivationText = isPremium && license?.mode === 'activated'
    ? 'Activated (no term expiry)'
    : license?.mode === 'trial'
      ? 'Trial active'
      : license?.mode
        ? String(license.mode).toUpperCase()
        : 'None';

  const openExternal = async (url: string) => {
    if (!url) return;
    if (window.pcOptiNative?.openExternalLink) {
      await window.pcOptiNative.openExternalLink(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openSupportEmail = async () => {
    await openExternal(`mailto:${CONSUMER_MONETIZATION_NOTES.legal.supportEmail}`);
  };
  const openSupportHelpCenter = async () => {
    if (!CONSUMER_CHECKOUT_CONFIG.helpCenterUrl) return;
    await openExternal(CONSUMER_CHECKOUT_CONFIG.helpCenterUrl);
  };
  const isCheckoutReady = CONSUMER_CHECKOUT_OFFERS.some((offer) => offer.status === 'Checkout active');
  const buttonSubtext = isCheckoutReady
    ? 'Checkout links are live. Open for live payment conversion.'
    : 'Add VITE_DIALED_CHECKOUT_* URLs in the build environment to enable one-click paid checkout.';

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/20 p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-[11px] font-semibold text-violet-200">
          <Sparkles className="h-3.5 w-3.5" />
          Consumer Premium upgrade center
        </div>
        <h2 className="mt-3 text-2xl font-bold text-white">Unlock full Consumer Premium workflow</h2>
        <p className="mt-1 text-sm text-slate-400">
          Consumer Premium unlocks reversible startup and timing workflows behind an explicit entitlement.
          Owner Edition remains unchanged, with every existing public/private capability intact.
        </p>
        <div className="mt-4 grid gap-3 text-xs text-slate-300 md:grid-cols-3">
          <MetricBlock title="Current runtime profile" value={profile === 'owner' ? "Owner's Edition" : isPremium ? 'Consumer Premium' : 'Public'} tone={isPremium ? 'premium' : 'default'} />
          <MetricBlock title="License mode" value={trialOrActivationText} tone="info" />
          <MetricBlock title="Trial/activation validity" value={license?.expiresAt ? expiryText : 'No active term-based window'} tone="info" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <button
            onClick={onRefreshRuntimeProfile}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BadgeCheck className="h-3.5 w-3.5" />
            Refresh entitlement
          </button>
          <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${isOwner ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100' : isPremium ? 'border-violet-400/40 bg-violet-500/15 text-violet-100' : 'border-amber-400/40 bg-amber-500/15 text-amber-100'}`}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {isOwner ? 'Owner entitlement active' : isPremium ? 'Premium enabled' : 'Premium disabled'}
          </span>
        </div>
      </section>

      {isOwner ? (
        <section className="rounded-2xl border border-slate-800 bg-emerald-950/20 p-4 text-sm text-emerald-100/90">
          <p className="font-semibold text-emerald-100">Owner Edition remains unchanged.</p>
          <p className="mt-1 text-xs text-emerald-100/80">
            The owner build keeps all capabilities that are currently available in this release and does not require consumer trial or activation.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-200">
              <CircleDollarSign className="h-3.5 w-3.5" />
              Conversion path
            </div>
            <h3 className="mt-3 text-xl font-bold text-white">Trial now, unlock later</h3>
            <p className="mt-1 text-sm text-slate-400">
              Clear, low-risk onboarding: try premium controls, then redeem a paid code or buy directly when your checkout route is active.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {CONSUMER_PREMIUM_OFFERS.map((offer) => (
                <div key={offer.days}>
                  <OfferCard
                    title={offer.title}
                    value={offer.headline}
                    description={offer.subtitle}
                    actionLabel={offer.actionLabel}
                    disabled={isPremium || isBusy}
                    onClick={() => onStartTrial(offer.days)}
                    badge={offer.note}
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-300">
              <p className="font-semibold text-cyan-200">Monetization roadmap:</p>
              <p className="mt-1">{CONSUMER_MONETIZATION_NOTES.pricing.status}</p>
              <p className="mt-1 text-[11px]">{buttonSubtext}</p>
              <p className="mt-1 text-[11px]">Provider: {CONSUMER_CHECKOUT_CONFIG.provider}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h3 className="text-xl font-bold text-white">Buy Consumer Premium</h3>
            <p className="mt-1 text-sm text-slate-400">
              Build-time checkout configuration is wired for one-time and annual purchase flows.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {CONSUMER_CHECKOUT_OFFERS.map((offer) => (
                <article key={offer.id} className="rounded-xl border border-slate-800 bg-slate-950/65 p-4">
                  <h4 className="text-sm font-semibold text-slate-100">{offer.title}</h4>
                  <p className="mt-1 text-2xl font-bold text-cyan-100">{offer.priceText}</p>
                  <p className="mt-1 text-xs text-slate-400">{offer.subtitle}</p>
                  <p className="mt-2 text-[11px] uppercase tracking-[0.1em] text-slate-500">[{offer.status}]</p>
                  <button
                    onClick={() => openExternal(offer.url)}
                    disabled={!isValidPublicUrl(offer.url) || isBusy}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-2.5 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {offer.buttonLabel}
                  </button>
                </article>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-300">
              <p className="font-semibold text-cyan-200">Promo and enterprise support:</p>
              <p className="mt-1">Promo/enterprise codes remain available through the redemptions flow. Keep legal/support links aligned with your storefront.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h3 className="text-xl font-bold text-white">Redeem code</h3>
            <p className="mt-1 text-sm text-slate-400">
              Enter a valid activation code to unlock Consumer Premium immediately.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={redeemCode}
                onChange={(event) => setRedeemCode(event.target.value)}
                className="block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400"
                placeholder="ENTER-CODE-HERE"
              />
              <button
                onClick={() => onRedeemLicense(redeemCode)}
                disabled={isBusy || !redeemCode.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Redeem
              </button>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2 text-[11px] uppercase tracking-wider text-slate-400">
              <span>{CONSUMER_MONETIZATION_NOTES.tagline}</span>
              <ArrowRight className="h-3 w-3" />
              <span>No cloud sync · No telemetry selloff</span>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h3 className="text-sm font-semibold text-white">Support, returns, and legal contact</h3>
            <ul className="mt-3 space-y-2 text-xs text-slate-300">
              <li className="flex gap-2"><Receipt className="h-3.5 w-3.5 text-violet-300" />Returns: {CONSUMER_MONETIZATION_NOTES.legal.returns}</li>
              <li className="flex gap-2"><CircleHelp className="h-3.5 w-3.5 text-violet-300" />Cancellation: {CONSUMER_MONETIZATION_NOTES.legal.cancellation}</li>
              <li className="flex gap-2"><CalendarDays className="h-3.5 w-3.5 text-violet-300" />Support SLA: {CONSUMER_MONETIZATION_NOTES.legal.supportResponseSla}</li>
              <li className="flex gap-2"><Gift className="h-3.5 w-3.5 text-violet-300" />Trial policy: {CONSUMER_MONETIZATION_NOTES.legal.trialWindow}</li>
            </ul>
            <button
              onClick={openSupportEmail}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Contact support
            </button>
            {CONSUMER_CHECKOUT_CONFIG.helpCenterUrl ? (
              <button
                onClick={openSupportHelpCenter}
                className="ml-2 mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-xs font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Visit help center
              </button>
            ) : null}
          </section>
        </>
      )}

      {status && <p className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 p-3 text-xs text-cyan-200">{status}</p>}
      {error && <p className="rounded-lg border border-rose-500/25 bg-rose-950/20 p-3 text-xs text-rose-200">{error}</p>}
    </div>
  );
}

function MetricBlock({ title, value, tone }: { title: string; value: string; tone: 'default' | 'premium' | 'info' }) {
  const palette = tone === 'premium'
    ? 'border-violet-400/30 bg-violet-500/10 text-violet-100'
    : tone === 'info'
      ? 'border-cyan-400/25 bg-cyan-500/10 text-cyan-100'
      : 'border-slate-700 bg-slate-900/60 text-slate-300';

  return (
    <article className={`rounded-xl border p-3 ${palette}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </article>
  );
}

function OfferCard({
  title,
  value,
  description,
  actionLabel,
  badge,
  disabled,
  onClick,
}: {
  title: string;
  value: string;
  description: string;
  actionLabel: string;
  badge?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-950/65 p-4">
      <h4 className="text-sm font-semibold text-slate-100">{title}</h4>
      <p className="mt-1 text-2xl font-bold text-cyan-100">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{description}</p>
      {badge ? <p className="mt-2 text-[11px] uppercase tracking-[0.1em] text-slate-500">[{badge}]</p> : null}
      <button
        onClick={onClick}
        disabled={disabled}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-2.5 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700"
      >
        {actionLabel}
      </button>
    </article>
  );
}
