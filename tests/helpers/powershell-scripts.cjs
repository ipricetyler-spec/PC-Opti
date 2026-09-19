'use strict';

/**
 * Finds every PowerShell script Dialed ships: each template or string literal in the
 * main-process code that reads as PowerShell, plus the .ps1 files. Interpolated parts
 * (`${...}`) are replaced with a harmless variable so a fragment can be parsed on its own.
 * Used by tests to check that Windows PowerShell can parse every script. Nothing is run.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..');
const SOURCES = [path.join(ROOT, 'src', 'main'), path.join(ROOT, 'electron')];
const PLACEHOLDER = '$__dialedValue';

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(cjs|ps1)$/.test(name)) out.push(full);
  }
  return out;
}

// PowerShell, not C#, JSON or prose: a variable plus a cmdlet or PowerShell construct.
function looksLikePowerShell(text) {
  if (text.length < 30) return false;
  // C# on its own is skipped; PowerShell that embeds C# with Add-Type is kept.
  if (!/Add-Type/.test(text) && /^\s*using System|public static (class|extern)|\[DllImport/m.test(text)) return false;
  const variable = /\$[A-Za-z_][\w:]*/.test(text);
  const construct = /\b(Get|Set|New|Remove|Test|ConvertTo|ConvertFrom|Select|Where|ForEach|Invoke|Start|Stop|Add|Out|Write|Join|Split|Import|Export|Register|Unregister|Enable|Disable|Optimize|Clear|Copy|Move|Rename)-[A-Z][A-Za-z]+\b|\[pscustomobject\]|\$ErrorActionPreference|\[Convert\]::|\$PSVersionTable/.test(text);
  return variable && construct;
}

// What an interpolated part stands for, judged from the text just before it:
//   `$${flag}`            → the rest of a PowerShell literal such as $true
//   `@{ ...; ${entries} }` → one or more hashtable entries
//   anything else         → a value
function stand_in(before) {
  if (before.endsWith('$')) return 'true';
  if (/(@\{|;)\s*$/.test(before) && before.lastIndexOf('@{') > before.lastIndexOf('}')) return "'dialedKey' = $null";
  return PLACEHOLDER;
}

function templateText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return node.text;
  let text = node.head.text;
  for (const span of node.templateSpans) text += stand_in(text) + span.literal.text;
  return text;
}

function listPowerShellScripts() {
  const scripts = [];
  for (const file of SOURCES.flatMap((dir) => walk(dir))) {
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    const raw = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.ps1')) { scripts.push({ where: relative, text: raw }); continue; }
    const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = (node) => {
      if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
        const text = templateText(node);
        if (looksLikePowerShell(text)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          scripts.push({ where: `${relative}:${line}`, text });
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return scripts;
}

module.exports = { listPowerShellScripts, PLACEHOLDER };
