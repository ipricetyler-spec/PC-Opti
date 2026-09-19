// PARKED: unreachable historical prototype; excluded from the active build.
import type { ConsumerLicenseState } from '../types';

export interface ConsumerTrialOffer {
  days: 7 | 14;
  title: string;
  subtitle: string;
  headline: string;
  actionLabel: string;
  note: string;
}

export interface ConsumerCheckoutOffer {
  id: 'one-time' | 'annual';
  title: string;
  subtitle: string;
  priceText: string;
  buttonLabel: string;
  url: string;
  status: string;
}

type MonetizationEnv = Record<string, string | undefined>;

function readMonetizationEnv(name: string): string {
  const env = (import.meta as ImportMeta & { env?: MonetizationEnv }).env;
  const value = env ? env[name] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function readProductEnv(suffix: string): string {
  return readMonetizationEnv(`VITE_DIALED_${suffix}`) || readMonetizationEnv(`VITE_PC_OPTI_${suffix}`);
}

function safeUrl(value: string) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function resolveAllowedHostMatch(url: string) {
  const allowList = readProductEnv('CHECKOUT_ALLOWED_HOSTS')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!allowList.length) return true;
  const host = safeUrl(url) ? new URL(url).hostname.toLowerCase() : '';
  return allowList.some((entry) => {
    const normalized = entry.startsWith('*.') ? entry.slice(2) : entry;
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function statusFromUrl(rawUrl: string) {
  if (!rawUrl) return 'Manual mode: add checkout URL in build environment to activate conversion.';
  if (!safeUrl(rawUrl)) return 'Invalid checkout URL: update to a valid https URL.';
  if (!resolveAllowedHostMatch(rawUrl)) return 'Checkout host not in allowed host list. Update VITE_DIALED_CHECKOUT_ALLOWED_HOSTS.';
  return 'Checkout active';
}

function buildCheckoutOffers() {
  const oneTimeUrl = safeUrl(readProductEnv('CHECKOUT_ONE_TIME_URL'));
  const annualUrl = safeUrl(readProductEnv('CHECKOUT_ANNUAL_URL'));
  const oneTimePrice = readProductEnv('CHECKOUT_ONE_TIME_PRICE') || 'Not configured';
  const annualPrice = readProductEnv('CHECKOUT_ANNUAL_PRICE') || 'Not configured';

  return [
    {
      id: 'one-time' as const,
      title: 'One-time license',
      subtitle: 'Single-device Consumer Premium entitlement.',
      priceText: oneTimePrice,
      buttonLabel: 'Buy one-time license',
      url: oneTimeUrl,
      status: statusFromUrl(oneTimeUrl),
    },
    {
      id: 'annual' as const,
      title: 'Annual entitlement',
      subtitle: 'Single-device annual renewal path with lower long-term effective price.',
      priceText: annualPrice,
      buttonLabel: 'Buy annual entitlement',
      url: annualUrl,
      status: statusFromUrl(annualUrl),
    },
  ];
}

export const CONSUMER_PREMIUM_OFFERS: ConsumerTrialOffer[] = [
  {
    days: 7,
    title: 'Starter trial',
    headline: '$0',
    subtitle: 'Try the premium tier without payment.',
    actionLabel: 'Start 7-day trial',
    note: 'Good for quick validation before any purchase decision.',
  },
  {
    days: 14,
    title: 'Longer confidence trial',
    headline: '$0',
    subtitle: 'Run a full workflow cycle before upgrading.',
    actionLabel: 'Start 14-day trial',
    note: 'Best fit for users who want one week of setup plus one week of measurement.',
  },
];

export const CONSUMER_CHECKOUT_OFFERS = buildCheckoutOffers();

export const CONSUMER_CHECKOUT_CONFIG = {
  provider: readProductEnv('CHECKOUT_PROVIDER') || 'custom-hosted-checkout',
  supportEmail: readProductEnv('SUPPORT_EMAIL') || '',
  helpCenterUrl: readProductEnv('SUPPORT_HELP_URL') || '',
  trialDefaultDays: readProductEnv('TRIAL_DEFAULT_DAYS') || '7',
};

export const CONSUMER_MONETIZATION_NOTES = {
  tagline: 'Safe. Reversible. Evidence-first.',
  pricing: {
    headline: 'Planned purchase options',
    oneTime: 'One-time activation (single-device)',
    annual: 'Annual entitlement renewal',
    promo: 'Promo / enterprise code redemption',
    status: 'Provider links are driven from VITE_DIALED_CHECKOUT_* environment variables and are live when configured.',
    supportEmail: CONSUMER_CHECKOUT_CONFIG.supportEmail,
  },
  benefitBullets: [
    'Reversible startup and EcoQoS control paths',
    'Timing experiments with visible before/after state',
    'Higher confidence workflows through history-backed verification',
  ],
  legal: {
    supportEmail: CONSUMER_CHECKOUT_CONFIG.supportEmail,
    supportResponseSla: '72-hour response window, excluding weekends.',
    returns: 'Refunds follow the storefront terms on the paid link used to purchase.',
    cancellation: 'You may cancel annual renewal through the same storefront before renewal date.',
    trialWindow: 'Trials expire automatically; no further action is required.',
  },
} as const;

export const isConsumerPremiumActive = (profile: 'public' | 'consumer-premium' | 'owner', license?: ConsumerLicenseState) =>
  profile === 'consumer-premium' || Boolean(license?.tier === 'premium');

function isPlaceholder(value: string) {
  return !value || /TODO|your-domain|example|placeholder|custom-hosted-checkout/i.test(value);
}

export function isConsumerCommerceConfigured() {
  const offers = CONSUMER_CHECKOUT_OFFERS;
  return offers.length > 0
    && offers.every((offer) => Boolean(offer.url) && !isPlaceholder(offer.priceText) && offer.status === 'Checkout active')
    && !isPlaceholder(CONSUMER_CHECKOUT_CONFIG.provider)
    && !isPlaceholder(CONSUMER_CHECKOUT_CONFIG.supportEmail);
}
