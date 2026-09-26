// Shared page helpers for the isolated browser fixture checks (check-*-ui.cjs).
const fs = require('node:fs');
const path = require('node:path');

/**
 * The themes the app ships, read from src/lib/themes.ts. The checks used to carry their own
 * list, which went stale when the themes changed: they kept setting ids the app no longer had,
 * so every "per theme" layout pass quietly tested the fallback styling.
 */
function appThemes() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'themes.ts'), 'utf8');
  const block = source.match(/APP_THEMES = \[([\s\S]*?)\] as const/);
  const themes = block ? [...block[1].matchAll(/id: '([a-z0-9-]+)',\s*name: '([^']+)'/g)].map(([, id, name]) => ({ id, name })) : [];
  const fallback = source.match(/DEFAULT_APP_THEME: AppThemeId = '([a-z0-9-]+)'/);
  if (!themes.length || !fallback || !themes.some((theme) => theme.id === fallback[1])) {
    throw new Error('Could not read the theme list from src/lib/themes.ts; update appThemes() in scripts/ui-fixture-page.cjs to match it.');
  }
  return { themes, defaultTheme: fallback[1] };
}

const RUN_HINT = 'Run `npm run test:ui:fixtures`: it builds the renderer, serves it on 127.0.0.1:5178, runs every fixture check and stops the server.';

/** Opens the fixture origin, or says how to get a server there instead of a bare network error. */
async function openFixture(page, origin) {
  try {
    await page.goto(origin);
  } catch (error) {
    if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(String(error && error.message))) {
      throw new Error(`Nothing is serving the fixture page at ${origin}. ${RUN_HINT}`, { cause: error });
    }
    throw error;
  }
}

function primaryNavigation(page) {
  return page.getByRole('navigation', { name: 'Primary navigation' });
}

/** The sidebar's section buttons. */
function sectionButtons(page) {
  return primaryNavigation(page).getByRole('button');
}

/**
 * One sidebar section, by its visible label. Matched by accessible name, which leaves out
 * the section number the sidebar shows before each label (it is aria-hidden).
 */
function sectionButton(page, label) {
  return primaryNavigation(page).getByRole('button', { name: label, exact: true });
}

/**
 * Opens a sidebar section. A label the sidebar does not have fails at once and lists the
 * sections it does have, rather than timing out: a renamed section should read as a stale
 * check, not a broken app.
 */
async function openSection(page, label) {
  await sectionButtons(page).first().waitFor();
  const button = sectionButton(page, label);
  if (await button.count() !== 1) {
    const labels = (await sectionButtons(page).allInnerTexts()).map((text) => text.split('\n').pop().trim());
    throw new Error(`The sidebar has no section labelled "${label}". Sections on the page: ${labels.join(', ')}.`);
  }
  await button.click();
}

module.exports = { appThemes, openFixture, openSection, sectionButton, sectionButtons, RUN_HINT };
