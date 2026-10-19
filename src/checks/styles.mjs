// Stylesheet hygiene, over every .scss file below src/:
//
// 1. Every @use/@forward/@import resolves. Sass only complains once
//    somebody opens exactly the screen that compiles the file.
// 2. No colour literal outside the colour sources (_theme-colors.scss and
//    whatever the app lists) unless a comment on that line or the line
//    above says why.
// 3. No raw px spacing or radius where a token of exactly that size exists
//    -- the sizes are read from variables.scss, so the check cannot drift
//    from the scale it enforces.
// 4. No var(--token) that is defined nowhere: neither in a stylesheet nor
//    as a "--name" string in the code (inline styles, setProperty). An
//    undefined token silently falls back to inherit or to its fallback --
//    usually a hardcoded colour that ignores the theme.

import { existsSync } from "node:fs";
import path from "node:path";
import { collectFiles, readText, toRelative } from "../files.mjs";
import { createReport, fail } from "../report.mjs";
import { customPropertiesOf, stripComments } from "../scss.mjs";

// A colour function only counts as a literal when its channels are numbers:
// `rgba(var(--color-primary-rgb), 0.1)` or `oklch(from var(--x) …)` derive
// from a token.
const COLOR_LITERAL = /(#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|hwb|lab|lch)\((?!\s*(var\(|from\s)))/;
const SPACING_PROPERTY = /^\s*(padding|margin|gap|row-gap|column-gap)(-[a-z-]+)?\s*:/;
const RADIUS_PROPERTY = /^\s*border(-[a-z]+)*-radius\s*:/;
const PX_VALUE = /(?<![\w.-])(\d{1,3})px\b/g;
const IMPORT = /@(use|forward|import)\s+["']([^"']+)["']/g;

function resolves(fromFile, reference) {
  if (/^(sass:|https?:|~)/.test(reference)) return true;
  const dir = path.resolve(path.dirname(fromFile), path.dirname(reference));
  const stem = path.basename(reference).replace(/\.(scss|css)$/, "");
  const candidates = [path.basename(reference), `${stem}.scss`, `_${stem}.scss`, `${stem}.css`, path.join(stem, "_index.scss"), path.join(stem, "index.scss")];
  return candidates.some((candidate) => existsSync(path.join(dir, candidate)));
}

/** px value -> token name for the tokens whose value is a plain px size. */
function sizeTokens(variables, prefix) {
  const out = new Map();
  for (const [name, value] of Object.entries(variables)) {
    const px = value.match(/^(\d+)px$/);
    if (name.startsWith(prefix) && px && !out.has(Number(px[1]))) out.set(Number(px[1]), `--${name}`);
  }
  return out;
}

/** The justification a deliberate literal needs: a comment on its own line,
 * or a comment above a run of such lines (`sameKind`) that it opens --
 * one reason for a block of fixed swatch colours is enough. */
function isJustified(lines, index, sameKind) {
  if (/\/\/|\/\*/.test(lines[index])) return true;
  for (let i = index - 1; i >= 0; i--) {
    const above = lines[i].trim();
    if (above.startsWith("//") || above.startsWith("/*") || above.endsWith("*/")) return true;
    if (!sameKind(lines[i])) return false;
  }
  return false;
}

export async function checkStyles(config) {
  const report = createReport("styles");
  const src = path.join(config.root, config.srcDir);
  const scssFiles = collectFiles(src, /\.(scss|css)$/, config.ignoreDirs);
  const codeFiles = collectFiles(src, /\.(tsx?|jsx?|html)$/, config.ignoreDirs);
  const variablesFile = path.join(config.root, config.variablesFile);
  const variables = existsSync(variablesFile) ? customPropertiesOf(readText(variablesFile), (s) => s === ":root") : {};
  const spacing = sizeTokens(variables, "space-");
  const radius = sizeTokens(variables, "radius-");
  // Stylesheets outside the app's token world: vendored libraries, styles
  // injected into an iframe where the custom properties do not reach.
  const foreign = (rel) => config.styles.foreign.some((prefix) => rel.startsWith(prefix));

  // Every custom property that exists somewhere: declared in a stylesheet
  // (`--x:`, or a family `--x-#{$key}:` from a Sass loop), or named as a
  // string in the code (`style={{ "--x": … }}`, `setProperty("--x", …)`).
  const defined = new Set(config.styles.externalProperties ?? []);
  const families = [];
  for (const file of [...scssFiles, ...codeFiles, path.join(config.root, "index.html")]) {
    if (!existsSync(file)) continue;
    const text = readText(file);
    for (const match of text.matchAll(/(?:^|[\s{;"'`])--([a-zA-Z0-9_-]+)\s*["'`]?\s*:/g)) defined.add(match[1]);
    for (const match of text.matchAll(/["'`]--([a-zA-Z0-9_-]+)["'`]/g)) defined.add(match[1]);
    for (const match of text.matchAll(/--([a-zA-Z0-9_-]*)#\{/g)) families.push(match[1]);
  }
  const isDefined = (name) => defined.has(name) || families.some((prefix) => prefix && name.startsWith(prefix));

  for (const file of scssFiles) {
    const rel = toRelative(config.root, file);
    if (foreign(rel)) continue;
    const raw = readText(file);
    const code = stripComments(raw);
    const rawLines = raw.split("\n");
    const lines = code.split("\n");

    for (const match of code.matchAll(IMPORT)) {
      if (!resolves(file, match[2])) fail(report, rel, code.slice(0, match.index).split("\n").length, `@${match[1]} "${match[2]}" does not resolve`);
    }

    const colorSource = config.styles.colorSources.includes(rel);
    lines.forEach((line, index) => {
      if (!line.trim() || /^\s*@(use|forward|import)\b/.test(line)) return;
      const at = index + 1;

      if (config.styles.literals && !colorSource && COLOR_LITERAL.test(line) && !isJustified(rawLines, index, (l) => COLOR_LITERAL.test(l))) {
        fail(report, rel, at, `colour literal without a comment saying why -- use a token: ${line.trim()}`);
      }

      const tokens = SPACING_PROPERTY.test(line) ? spacing : RADIUS_PROPERTY.test(line) ? radius : null;
      if (config.styles.literals && tokens && !isJustified(rawLines, index, (l) => SPACING_PROPERTY.test(l) || RADIUS_PROPERTY.test(l))) {
        for (const px of line.matchAll(PX_VALUE)) {
          const token = tokens.get(Number(px[1]));
          if (token) fail(report, rel, at, `${px[0]} instead of var(${token}): ${line.trim()}`);
        }
      }

      for (const usage of line.matchAll(/var\(\s*--([a-zA-Z0-9_-]+)/g)) {
        const name = usage[1];
        if (!isDefined(name) && !name.endsWith("-")) {
          fail(report, rel, at, `var(--${name}) is defined nowhere`);
        }
      }
    });
  }

  for (const file of codeFiles) {
    const rel = toRelative(config.root, file);
    const text = stripComments(readText(file));
    for (const usage of text.matchAll(/var\(\s*--([a-zA-Z0-9_-]+)/g)) {
      const name = usage[1];
      if (!isDefined(name) && !name.endsWith("-")) fail(report, rel, text.slice(0, usage.index).split("\n").length, `var(--${name}) is defined nowhere`);
    }
  }

  report.summary = `${scssFiles.length} stylesheet(s), spacing scale ${[...spacing.keys()].join("/")}px`;
  return report;
}
