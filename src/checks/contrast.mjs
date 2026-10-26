// WCAG contrast of the colours the app actually paints, in every theme.
// Three phases:
//
// 1. Token pairs: the app's `contrast.pairs` list, resolved against the
//    theme mixins in _theme-colors.scss (plus the role tokens in
//    variables.scss). A token that does not resolve is a failure, not a
//    skip -- a renamed token must not silently drop out of the check.
// 2. Same-rule pairs: every SCSS rule that sets both `color` and a
//    background, checked automatically. A rule with a colour but no
//    background of its own is checked too when its stylesheet is a declared
//    `contrast.surfaces` entry: a bar or panel drawn on a background that
//    comes from an ancestor in another component (the editor's dark desk).
// 3. Rendered pairs: a text colour set on a JSX element (inline style or
//    its CSS-module class) against the background of its nearest ancestor
//    element in the same .tsx file -- this catches a themed text colour on
//    a hardcoded surface, where neither side is a token pair.
//
// Phases 2 and 3 only report when BOTH sides resolve to an opaque colour;
// anything dynamic, inherited or layered is skipped rather than guessed.

import * as ts from "typescript/unstable/ast";
import {parseSourceFiles} from "../typescript.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { contrastRatio, parseColor, toHex } from "../color.mjs";
import { collectFiles, readText, toRelative } from "../files.mjs";
import { createReport, fail } from "../report.mjs";
import { customPropertiesOf, flattenSelector, parseRules, resolveColorTokens } from "../scss.mjs";

/** Raw tokens per theme: `:root` of variables.scss underneath, the theme
 * mixin on top -- role tokens like `--color-button-bg: var(--color-primary)`
 * live in the former and resolve against the latter. */
function themeTokens(config) {
  const variablesFile = path.join(config.root, config.variablesFile);
  const base = existsSync(variablesFile) ? customPropertiesOf(readText(variablesFile), (s) => s === ":root") : {};
  const theme = readText(path.join(config.root, config.themeFile));
  const out = {};
  for (const [label, mixin] of Object.entries(config.themes)) {
    const own = customPropertiesOf(theme, (s) => s === `@mixin ${mixin}` || s.startsWith(`@mixin ${mixin}(`));
    if (Object.keys(own).length === 0) throw new Error(`@mixin ${mixin} not found in ${config.themeFile}`);
    const raw = { ...base, ...own };
    out[label] = { colors: resolveColorTokens(raw), raw };
  }
  return out;
}

/** What a rule paints behind its text: `none` (transparent -- an ancestor's
 * background still applies), `color`, or `unknown` (an image, gradient or
 * unresolvable value: an opaque barrier nothing inside may be measured
 * through). */
function backgroundOf(decls, tokens) {
  const image = decls["background-image"];
  if (image && image.trim().toLowerCase() !== "none") return { state: "unknown" };
  for (const prop of ["background-color", "background"]) {
    const raw = decls[prop];
    if (!raw) continue;
    const value = raw.trim().toLowerCase();
    if (value === "transparent" || value === "none") continue;
    if (prop === "background" && /gradient|url\(/.test(value)) return { state: "unknown" };
    const color = parseColor(raw, tokens);
    return color ? { state: "color", color, raw } : { state: "unknown" };
  }
  return { state: "none" };
}

/** WCAG AA: 4.5:1 for body text, 3:1 once it is large (>= 24px, or
 * >= 18.66px bold). Relative sizes assume the 16px root. */
function thresholdFor(decls) {
  const size = String(decls?.["font-size"] ?? "").match(/^([\d.]+)\s*(px|em|rem)?$/);
  const px = size ? parseFloat(size[1]) * (size[2] === "px" ? 1 : 16) : null;
  const weight = decls?.["font-weight"];
  const bold = weight === "bold" || parseInt(weight, 10) >= 700;
  return px !== null && (px >= 24 || (bold && px >= 18.66)) ? 3.0 : 4.5;
}

const strip = (name) => name.replace(/^--/, "");
const tokenName = (raw) => String(raw ?? "").trim().match(/^var\(\s*--([\w-]+)\s*\)$/)?.[1];

/** The token a value actually paints with: `var(--x, fallback)` is x when the
 * theme defines it, otherwise whatever its fallback names (as parseColor). */
function paintedToken(raw, colors) {
  const match = String(raw ?? "").replace(/!important/i, "").trim().match(/^var\(\s*--([\w-]+)\s*(?:,([\s\S]+))?\)$/);
  if (!match) return undefined;
  return colors[match[1]] || !match[2] ? match[1] : paintedToken(match[2], colors);
}

/** The bar a measured pair must clear: the declared threshold (or accepted
 * exception) when both sides are a token pair the app lists, otherwise WCAG
 * by font size -- so one combination is judged the same in every phase. */
function floorFor(config, label, pairs, raw, colors) {
  // An alias (`--color-surface: var(--color-bg)`) is the token it names.
  const canonical = (name, seen = new Set()) => {
    const alias = name && !seen.has(name) ? tokenName(raw[name]) : undefined;
    return alias ? canonical(alias, seen.add(name)) : name;
  };
  const keyOf = (fg, bg) => `${canonical(strip(fg))}:${canonical(strip(bg))}`;
  const declared = new Map(pairs.map(([fg, bg, min]) => [keyOf(fg, bg), min]));
  const exceptions = new Map(Object.entries(config.contrast.exceptions)
    .filter(([key]) => key.startsWith(`${label}:`))
    .map(([key, value]) => [keyOf(...key.split(":").slice(1)), value.min]));
  return (fgRaw, bgRaw, decls) => {
    const fg = paintedToken(fgRaw, colors);
    const bg = paintedToken(bgRaw, colors);
    if (!fg || !bg) return thresholdFor(decls);
    const key = keyOf(fg, bg);
    return exceptions.get(key) ?? declared.get(key) ?? thresholdFor(decls);
  };
}

const isBaseClassSelector = (selector) => /^\.[A-Za-z0-9_-]+$/.test(selector);

/** class name -> merged declarations of its plain `.name` rules. */
function classIndex(file, cache) {
  if (cache.has(file)) return cache.get(file);
  const index = new Map();
  if (existsSync(file)) {
    for (const rule of parseRules(readText(file))) {
      const selector = flattenSelector(rule.chain);
      if (selector && isBaseClassSelector(selector) && rule.chain.every((s) => !s.startsWith("@"))) {
        const name = selector.slice(1);
        index.set(name, { ...(index.get(name) ?? {}), ...rule.decls });
      }
    }
  }
  cache.set(file, index);
  return index;
}

function checkTokenPairs(report, config, label, tokens, pairs) {
  for (const [fgName, bgName, minimum] of pairs) {
    const fg = tokens[strip(fgName)];
    const bg = tokens[strip(bgName)];
    if (!fg || !bg) {
      fail(report, config.themeFile, 1, `${label}: ${!fg ? fgName : bgName} does not resolve to an oklch() colour`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const exception = config.contrast.exceptions[`${label}:${strip(fgName)}:${strip(bgName)}`];
    const floor = exception ? exception.min : minimum;
    const line = `${label}: ${fgName} on ${bgName} (${toHex(fg)} on ${toHex(bg)}) ${ratio.toFixed(2)}:1, needs ${minimum}:1`;
    if (ratio + 0.005 < floor) fail(report, config.themeFile, 1, line);
    else report.info.push(exception ? `KNOWN ${line} [${exception.reason}]` : `OK ${line}`);
  }
  return pairs.length;
}


/** The background a stylesheet's rules stand on when they set none of their
 * own, from `contrast.surfaces` -- or null. */
function surfaceOf(config, rel) {
  const surface = config.contrast.surfaces.find((entry) => entry.files.includes(rel));
  return surface ? `var(--${strip(surface.background)})` : null;
}

function checkSameRule(report, config, { label, tokens, floor }, scssFiles) {
  let checked = 0;
  for (const file of scssFiles) {
    const rel = toRelative(config.root, file);
    if (config.styles.colorSources.includes(rel)) continue;
    const surface = surfaceOf(config, rel);
    for (const rule of parseRules(readText(file))) {
      const selector = flattenSelector(rule.chain);
      // WCAG 1.4.3 exempts inactive controls.
      if (!selector || /:disabled|\[disabled\]|\[aria-disabled/.test(selector)) continue;
      const fg = parseColor(rule.decls.color, tokens);
      let bg = backgroundOf(rule.decls, tokens);
      if (bg.state === "none" && surface) {
        const color = parseColor(surface, tokens);
        bg = color ? { state: "color", color, raw: surface } : { state: "unknown" };
      }
      if (!fg || bg.state !== "color") continue;
      checked++;
      const threshold = floor(rule.decls.color, bg.raw, rule.decls);
      const ratio = contrastRatio(fg, bg.color);
      if (ratio + 0.005 < threshold) {
        fail(report, rel, rule.line, `${label}: ${selector.replace(/\s+/g, " ")} (${toHex(fg)} on ${toHex(bg.color)}) ${ratio.toFixed(2)}:1, needs ${threshold}:1`);
      }
    }
  }
  return checked;
}

const jsxAttribute = (node, name) => node.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);

/** Classes from `class={styles.x}`, `class="global"` or a template mixing
 * both. `classList` is conditional and therefore ignored. */
function classNamesOf(node, modules) {
  const attr = jsxAttribute(node, "class");
  const names = [];
  const words = (text) => text.split(/\s+/).filter(Boolean).map((name) => ({ name }));
  const visit = (expr) => {
    if (!expr) return;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) names.push(...words(expr.text));
    else if (ts.isPropertyAccessExpression(expr) && modules.has(expr.expression.getText())) names.push({ name: expr.name.getText(), module: expr.expression.getText() });
    else if (ts.isElementAccessExpression(expr) && modules.has(expr.expression.getText()) && ts.isStringLiteral(expr.argumentExpression)) names.push({ name: expr.argumentExpression.text, module: expr.expression.getText() });
    else if (ts.isTemplateExpression(expr)) {
      names.push(...words(expr.head.text));
      for (const span of expr.templateSpans) {
        visit(span.expression);
        names.push(...words(span.literal.text));
      }
    } else if (ts.isJsxExpression(expr)) visit(expr.expression);
  };
  visit(attr?.initializer);
  return names;
}

/** `style={{ color: "..." }}` -- literal string values only. */
function inlineStyleOf(node) {
  const expr = jsxAttribute(node, "style")?.initializer;
  const decls = {};
  if (!expr || !ts.isJsxExpression(expr) || !expr.expression || !ts.isObjectLiteralExpression(expr.expression)) return decls;
  for (const prop of expr.expression.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name) ? prop.name.text : null;
    const value = ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer) ? prop.initializer.text : null;
    if (key && value) decls[key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)] = value;
  }
  return decls;
}

/** An element whose content is icons and nothing else -- no text, no
 * expression that could be text -- is a graphic too (a wrapper around a
 * glyph, a toggle between two glyphs). */
function onlyIcons(node, icons) {
  if (!ts.isJsxElement(node)) return false;
  let sawIcon = false;
  let sawText = false;
  const walk = (child) => {
    if (sawText) return;
    if (ts.isJsxText(child)) {
      if (child.text.trim()) sawText = true;
      return;
    }
    if (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) {
      if (icons.has(child.tagName.getText())) sawIcon = true;
      // Attribute values are no content.
      return;
    }
    if (ts.isJsxExpression(child) && child.expression && !ts.isJsxElement(child.expression) && !ts.isJsxSelfClosingElement(child.expression) && !ts.isJsxFragment(child.expression)) {
      sawText = true;
      return;
    }
    child.forEachChild(walk);
  };
  node.children.forEach(walk);
  return sawIcon && !sawText;
}

function checkRendered(report, config, { label, tokens, floor }, tsxFiles, globalIndex, cache) {
  let checked = 0;
  for (const [file, sf] of parseSourceFiles(tsxFiles)) {
    const rel = toRelative(config.root, file);
    const modules = new Map();
    // Icons are graphics, not text: WCAG 1.4.11 asks 3:1 of them.
    const icons = new Set();
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const from = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (from.endsWith(".scss") && clause?.name) {
        modules.set(clause.name.getText(), classIndex(path.resolve(path.dirname(file), from), cache));
      } else if (/^lucide-solid(\/|$)/.test(from)) {
        if (clause?.name) icons.add(clause.name.getText());
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) icons.add(element.name.getText());
        }
      }
    }
    const declsOf = (classes) => {
      let merged = null;
      for (const cls of classes) {
        const decls = cls.module ? modules.get(cls.module)?.get(cls.name) : globalIndex.get(cls.name);
        if (decls) merged = { ...(merged ?? {}), ...decls };
      }
      return merged ?? {};
    };

    const walk = (node, background) => {
      let next = background;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const target = ts.isJsxElement(node) ? node.openingElement : node;
        const line = sf.getLineAndCharacterOfPosition(target.getStart(sf)).line + 1;
        const inline = inlineStyleOf(target);
        const decls = { ...declsOf(classNamesOf(target, modules)), ...inline };
        const own = backgroundOf(decls, tokens);
        if (own.state === "color") next = { color: own.color, raw: own.raw, where: `${rel}:${line}` };
        else if (own.state === "unknown") next = null;

        const fg = parseColor(decls.color, tokens);
        const behind = own.state === "color" ? own : own.state === "none" ? background : null;
        const bg = behind?.color;
        // Colour and background from the element's own class are one CSS
        // rule's business -- phase 2 reports those.
        const ownClassPair = own.state === "color" && !inline.color && !inline["background-color"] && !inline.background;
        if (fg && bg && !ownClassPair && !jsxAttribute(target, "disabled")) {
          checked++;
          const declared = floor(decls.color, behind.raw, decls);
          const threshold = icons.has(target.tagName.getText()) || onlyIcons(node, icons) ? Math.min(3.0, declared) : declared;
          const ratio = contrastRatio(fg, bg);
          if (ratio + 0.005 < threshold) {
            const from = own.state === "color" ? "own background" : `background from ${background.where}`;
            fail(report, rel, line, `${label}: <${target.tagName.getText()}> text ${toHex(fg)} on ${toHex(bg)} (${from}) ${ratio.toFixed(2)}:1, needs ${threshold}:1`);
          }
        }
      }
      node.forEachChild((child) => walk(child, next));
    };
    walk(sf, null);
  }
  return checked;
}

export async function checkContrast(config) {
  const report = createReport("contrast");
  const themes = themeTokens(config);
  const src = path.join(config.root, config.srcDir);
  const scssFiles = collectFiles(src, /\.scss$/, config.ignoreDirs);
  const tsxFiles = collectFiles(src, /\.tsx$/, config.ignoreDirs).filter((f) => !/\.test\.tsx$/.test(f));
  const cache = new Map();

  // Global (non-module) classes, referenced from JSX as plain strings.
  const globalIndex = new Map();
  for (const file of collectFiles(path.join(config.root, config.stylesDir), /\.scss$/, config.ignoreDirs)) {
    for (const [name, decls] of classIndex(file, cache)) if (!globalIndex.has(name)) globalIndex.set(name, decls);
  }

  let pairs = 0;
  let derived = 0;
  for (const [label, { colors: tokens, raw }] of Object.entries(themes)) {
    const declared = [...config.contrast.pairs, ...config.contrast.extraPairs(tokens)];
    pairs += checkTokenPairs(report, config, label, tokens, declared);
    if (config.contrast.derived) {
      const theme = { label, tokens, floor: floorFor(config, label, declared, raw, tokens) };
      derived += checkSameRule(report, config, theme, scssFiles);
      derived += checkRendered(report, config, theme, tsxFiles, globalIndex, cache);
    }
  }
  report.summary = `${Object.keys(themes).length} theme(s), ${pairs} token pair(s), ${derived} derived pair(s)`;
  return report;
}
