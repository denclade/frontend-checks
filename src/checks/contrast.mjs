// WCAG contrast of the colours the app actually paints, in every theme.
// Three phases:
//
// 1. Token pairs: the app's `contrast.pairs` list, resolved against the
//    theme mixins in _theme-colors.scss (plus the role tokens in
//    variables.scss). A token that does not resolve is a failure, not a
//    skip -- a renamed token must not silently drop out of the check.
// 2. Same-rule pairs: every SCSS rule that sets both `color` and a
//    background, checked automatically.
// 3. Rendered pairs: a text colour set on a JSX element (inline style or
//    its CSS-module class) against the background of its nearest ancestor
//    element in the same .tsx file -- this catches a themed text colour on
//    a hardcoded surface, where neither side is a token pair.
//
// Phases 2 and 3 only report when BOTH sides resolve to an opaque colour;
// anything dynamic, inherited or layered is skipped rather than guessed.

import ts from "typescript";
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
    out[label] = resolveColorTokens({ ...base, ...own });
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
    return color ? { state: "color", color } : { state: "unknown" };
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

function checkTokenPairs(report, config, label, tokens) {
  const pairs = [...config.contrast.pairs, ...config.contrast.extraPairs(tokens)];
  for (const [fgName, bgName, minimum] of pairs) {
    const fg = tokens[fgName.replace(/^--/, "")];
    const bg = tokens[bgName.replace(/^--/, "")];
    if (!fg || !bg) {
      fail(report, config.themeFile, 1, `${label}: ${!fg ? fgName : bgName} does not resolve to an oklch() colour`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const exception = config.contrast.exceptions[`${label}:${fgName.replace(/^--/, "")}:${bgName.replace(/^--/, "")}`];
    const floor = exception ? exception.min : minimum;
    const line = `${label}: ${fgName} on ${bgName} (${toHex(fg)} on ${toHex(bg)}) ${ratio.toFixed(2)}:1, needs ${minimum}:1`;
    if (ratio + 0.005 < floor) fail(report, config.themeFile, 1, line);
    else report.info.push(exception ? `KNOWN ${line} [${exception.reason}]` : `OK ${line}`);
  }
  return pairs.length;
}

function checkSameRule(report, config, label, tokens, scssFiles) {
  let checked = 0;
  for (const file of scssFiles) {
    const rel = toRelative(config.root, file);
    if (config.styles.colorSources.includes(rel)) continue;
    for (const rule of parseRules(readText(file))) {
      const selector = flattenSelector(rule.chain);
      // WCAG 1.4.3 exempts inactive controls.
      if (!selector || /:disabled|\[disabled\]|\[aria-disabled/.test(selector)) continue;
      const fg = parseColor(rule.decls.color, tokens);
      const bg = backgroundOf(rule.decls, tokens);
      if (!fg || bg.state !== "color") continue;
      checked++;
      const threshold = thresholdFor(rule.decls);
      const ratio = contrastRatio(fg, bg.color);
      if (ratio + 0.005 < threshold) {
        fail(report, rel, rule.line, `${label}: ${selector} (${toHex(fg)} on ${toHex(bg.color)}) ${ratio.toFixed(2)}:1, needs ${threshold}:1`);
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

function checkRendered(report, config, label, tokens, tsxFiles, globalIndex, cache) {
  let checked = 0;
  for (const file of tsxFiles) {
    const rel = toRelative(config.root, file);
    const sf = ts.createSourceFile(file, readText(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const modules = new Map();
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !stmt.moduleSpecifier.text.endsWith(".scss")) continue;
      const name = stmt.importClause?.name?.getText();
      if (name) modules.set(name, classIndex(path.resolve(path.dirname(file), stmt.moduleSpecifier.text), cache));
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
        if (own.state === "color") next = { color: own.color, where: `${rel}:${line}` };
        else if (own.state === "unknown") next = null;

        const fg = parseColor(decls.color, tokens);
        const bg = own.state === "color" ? own.color : own.state === "none" ? background?.color : null;
        // Colour and background from the element's own class are one CSS
        // rule's business -- phase 2 reports those.
        const ownClassPair = own.state === "color" && !inline.color && !inline["background-color"] && !inline.background;
        if (fg && bg && !ownClassPair && !jsxAttribute(target, "disabled")) {
          checked++;
          const threshold = thresholdFor(decls);
          const ratio = contrastRatio(fg, bg);
          if (ratio + 0.005 < threshold) {
            const from = own.state === "color" ? "own background" : `background from ${background.where}`;
            fail(report, rel, line, `${label}: <${target.tagName.getText()}> text ${toHex(fg)} on ${toHex(bg)} (${from}) ${ratio.toFixed(2)}:1, needs ${threshold}:1`);
          }
        }
      }
      ts.forEachChild(node, (child) => walk(child, next));
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
  for (const [label, tokens] of Object.entries(themes)) {
    pairs += checkTokenPairs(report, config, label, tokens);
    if (config.contrast.derived) {
      derived += checkSameRule(report, config, label, tokens, scssFiles);
      derived += checkRendered(report, config, label, tokens, tsxFiles, globalIndex, cache);
    }
  }
  report.summary = `${Object.keys(themes).length} theme(s), ${pairs} token pair(s), ${derived} derived pair(s)`;
  return report;
}
