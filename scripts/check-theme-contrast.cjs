// Browser-computed representative token contrast. Not a whole-app WCAG audit.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.DIALED_PLAYWRIGHT_PATH || 'playwright');
const origin = process.env.DIALED_UI_URL || 'http://127.0.0.1:5178';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only loopback fixture servers are allowed.');
const themes = ['midnight', 'ember', 'violet', 'forest', 'graphite', 'oled', 'aurora', 'carbon-gold'];
const themeNames = ['Midnight Signal', 'Ember', 'Ultraviolet', 'Evergreen', 'Graphite', 'OLED Neon', 'Aurora Shift', 'Carbon Gold'];
const out = path.resolve(__dirname, '../output/playwright');

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = {
    scope: 'Computed representative CSS text, controls, status and focus samples on the theme solid surface. Colours include alpha and disabled-control group opacity. No hardware or production latency evidence.',
    limitations: ['Default gradient surface pixel positions were not sampled; solid-surface results cannot establish gradient contrast.', 'Disabled controls are exempt from WCAG contrast requirements; ratios are diagnostic only.', 'Focus contrast is a representative colour comparison, not a complete focus area/obscuration audit.', 'No full-app WCAG or screen-reader acceptance claim.'],
    observations: [], samples: [],
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
    // Explicit browser-only mode: no IPC bridge and no native fallback.
    await context.addInitScript(() => { window.pcOptiNative = undefined; });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const began = Date.now();
    await page.goto(origin);
    await page.locator('aside nav').waitFor();
    report.observations.push({ operation: 'fixture initial navigation to visible sidebar', elapsedMs: Date.now() - began, sampleCount: 1 });
    const settingsBegan = Date.now();
    await page.locator('aside nav button').filter({ hasText: /^Settings/ }).click();
    await page.getByRole('heading', { name: 'Choose your Dialed theme' }).waitFor();
    report.observations.push({ operation: 'fixture Settings navigation to theme heading', elapsedMs: Date.now() - settingsBegan, sampleCount: 1 });
    await page.evaluate(() => {
      const surface = document.createElement('section');
      surface.id = 'contrast-fixture';
      surface.setAttribute('aria-label', 'Representative contrast fixture');
      surface.style.cssText = 'background:var(--app-surface-strong);padding:24px;display:grid;gap:12px;position:relative;z-index:100';
      const definitions = [
        ['primary', 'text-slate-100', false], ['secondary-text', 'text-slate-400', false],
        ['faint-text', 'text-slate-500', false], ['primary-accent-text', 'text-cyan-300', false],
        ['secondary-accent-text', 'text-violet-300', false],
        ['primary-action', 'bg-cyan-400 text-slate-950', false],
        ['disabled-action', 'bg-cyan-400 text-slate-950 disabled:opacity-50', true],
        ['success-status', 'bg-emerald-950/20 text-emerald-300', false],
        ['warning-status', 'bg-amber-950/20 text-amber-100', false],
        ['error-status', 'bg-rose-950/20 text-rose-200', false],
        ['focus', 'text-slate-100', false],
      ];
      for (const [id, classes, disabled] of definitions) {
        const sample = document.createElement('button');
        sample.id = `contrast-${id}`; sample.className = classes;
        sample.textContent = `${id}: Representative normal-size text`;
        sample.disabled = disabled;
        sample.style.cssText = 'padding:10px;font-size:14px;text-align:left';
        surface.append(sample);
      }
      document.body.append(surface);
    });
    await page.keyboard.press('Tab');
    for (const theme of themes) {
      await page.getByRole('button', { name: new RegExp(`^${themeNames[themes.indexOf(theme)]}`) }).click();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.keyboard.press('Tab');
      await page.evaluate(() => { document.getElementById('contrast-focus').focus(); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const samples = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        function rgba(css) {
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
          const p = ctx.getImageData(0, 0, 1, 1).data;
          return [p[0], p[1], p[2], p[3] / 255];
        }
        const over = (fg, bg) => [0,1,2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
        const luminance = rgb => rgb.slice(0,3).map(n => { const c = n / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (a,b) => { const x = luminance(a), y = luminance(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
        const surface = rgba(getComputedStyle(document.getElementById('contrast-fixture')).backgroundColor);
        return [...document.querySelectorAll('#contrast-fixture button')].map(element => {
          const css = getComputedStyle(element);
          const background = over(rgba(css.backgroundColor), surface);
          const foreground = over(rgba(css.color), background);
          const opacity = Number(css.opacity);
          const visibleBackground = over([...background, opacity], surface);
          const visibleForeground = over([...foreground, opacity], surface);
          const isFocus = element.id === 'contrast-focus';
          const outline = over(rgba(css.outlineColor), surface);
          return {
            sample: element.id.replace('contrast-', ''), foreground: css.color, background: css.backgroundColor, surface: surface.slice(0,3), opacity,
            ratio: Number((isFocus ? ratio(outline, surface) : ratio(visibleForeground, visibleBackground)).toFixed(2)),
            threshold: element.disabled ? null : isFocus ? 3 : 4.5,
            ...(isFocus ? { outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth, outlineColour: css.outlineColor } : {}),
          };
        });
      });
      if (samples.some(sample => !Number.isFinite(sample.ratio))) throw new Error(`Could not resolve a finite contrast ratio for ${theme}.`);
      report.samples.push(...samples.map(sample => ({ theme, ...sample, result: sample.threshold === null ? 'EXEMPT_DIAGNOSTIC' : sample.ratio >= sample.threshold && (sample.sample !== 'focus' || sample.outlineStyle !== 'none') ? 'MEETS_SAMPLED_THRESHOLD' : 'REVIEW' })));
    }
    report.pageErrors = errors;
    report.findings = report.samples.filter(sample => sample.result === 'REVIEW');
    fs.writeFileSync(path.join(out, 'theme-contrast-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ samples: report.samples.length, findings: report.findings.map(({theme,sample,ratio}) => ({theme,sample,ratio})), observations: report.observations, pageErrors: errors }, null, 2));
    if (errors.length) throw new Error('Page errors in contrast fixture.');
    if (report.findings.length) throw new Error('Representative solid-surface contrast regressed; see theme-contrast-report.json.');
    // Findings are an audit result; this script does not label the whole product accessible.
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
