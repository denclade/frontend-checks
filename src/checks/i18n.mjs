// Consistency of the translations, read straight from the inlang project
// (locales and message files from project.inlang/settings.json -- both the
// Paraglide 1 and the Paraglide 2 key names are understood):
//
// 1. Key parity: every key exists in every locale. A missing key falls
//    back silently at runtime.
// 2. Placeholder parity: the {placeholders} of a message are the same in
//    every locale -- otherwise a name or count silently drops out of the
//    sentence, or "undefined" is printed.
// 3. A key the code asks for (`m.key` in a file importing the messages)
//    exists.
// 4. A key defined twice for one locale, across message files.
// 5. With `featureMessagesDir`: a feature's messages folder that the
//    project does not list, so nothing compiles it.
//
// Warnings, not failures: keys nothing references (minus `dynamicKeys`),
// and a feature file repeating wording the main file already has.

import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { collectFiles, readText, toRelative } from "../files.mjs";
import { createReport, fail, warn } from "../report.mjs";

function readSettings(root) {
  const settings = JSON.parse(readFileSync(path.join(root, "project.inlang/settings.json"), "utf8"));
  const baseLocale = settings.baseLocale ?? settings.sourceLanguageTag;
  const locales = settings.locales ?? settings.languageTags;
  const pattern = settings["plugin.inlang.messageFormat"]?.pathPattern ?? "./messages/{locale}.json";
  return { baseLocale, locales, patterns: Array.isArray(pattern) ? pattern : [pattern] };
}

const fileFor = (root, pattern, locale) => path.join(root, pattern.replace("{languageTag}", locale).replace("{locale}", locale));
const placeholders = (message) => new Set([...JSON.stringify(message).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** Every `m.key` in the code (not in comments), with its line. */
function messageReferences(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "m") {
      out.push({ key: node.name.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export async function checkI18n(config) {
  const report = createReport("i18n");
  const { root } = config;
  const { baseLocale, locales, patterns } = readSettings(root);

  // locale -> key -> { file, message }
  const catalog = {};
  for (const locale of locales) {
    catalog[locale] = new Map();
    for (const pattern of patterns) {
      const file = fileFor(root, pattern, locale);
      const rel = toRelative(root, file);
      if (!existsSync(file)) {
        fail(report, rel, 1, `message file for ${locale} is missing`);
        continue;
      }
      for (const [key, message] of Object.entries(JSON.parse(readFileSync(file, "utf8")))) {
        if (key === "$schema") continue;
        const earlier = catalog[locale].get(key);
        if (earlier) fail(report, rel, 1, `"${key}" is also defined in ${earlier.file}`);
        catalog[locale].set(key, { file: rel, message });
      }
    }
  }

  const base = catalog[baseLocale];
  const allKeys = new Set(locales.flatMap((locale) => [...catalog[locale].keys()]));
  for (const key of [...allKeys].sort()) {
    const present = locales.filter((locale) => catalog[locale].has(key));
    const where = catalog[present[0]].get(key).file;
    for (const locale of locales.filter((l) => !present.includes(l))) fail(report, where, 1, `"${key}" has no ${locale} translation`);
    if (!base.has(key)) continue;
    const expected = placeholders(base.get(key).message);
    for (const locale of present) {
      const actual = placeholders(catalog[locale].get(key).message);
      if (!sameSet(expected, actual)) {
        fail(report, catalog[locale].get(key).file, 1, `"${key}" uses {${[...actual].join(", ")}} in ${locale} but {${[...expected].join(", ")}} in ${baseLocale}`);
      }
    }
  }

  // What the code refers to. Only files importing the messages count, so a
  // local `m` (a regex match, a map) cannot be mistaken for them. A bare
  // reference counts as use: a key stored as a function value in a lookup
  // table is called later under another name.
  const referenced = new Set();
  for (const dir of config.i18n.sourceDirs) {
    for (const file of collectFiles(path.join(root, dir), /\.(tsx?|jsx?|mjs)$/, config.ignoreDirs)) {
      const text = readText(file);
      if (!/import\s+\*\s+as\s+m\s+from\s+["'][^"']*paraglide\/messages(\.js)?["']/.test(text)) continue;
      for (const { key, line } of messageReferences(file, text)) {
        referenced.add(key);
        if (!base.has(key)) fail(report, toRelative(root, file), line, `m.${key} has no message in ${baseLocale}`);
      }
    }
  }

  const dynamic = config.i18n.dynamicKeys;
  const unused = [...base.keys()].filter((key) => !referenced.has(key) && !dynamic.some((pattern) => pattern.test(key)));
  for (const key of unused.sort()) warn(report, base.get(key).file, null, `"${key}" is never referenced`);

  if (config.i18n.featureMessagesDir) {
    const listed = new Set(patterns.map((pattern) => toRelative(root, path.dirname(fileFor(root, pattern, baseLocale)))));
    const featuresDir = path.join(root, config.i18n.featureMessagesDir);
    for (const entry of readdirSync(featuresDir, { withFileTypes: true })) {
      const messages = toRelative(root, path.join(featuresDir, entry.name, "messages"));
      if (entry.isDirectory() && existsSync(path.join(root, messages)) && !listed.has(messages)) {
        fail(report, "project.inlang/settings.json", 1, `${messages} is not in pathPattern -- add "./${messages}/{locale}.json"`);
      }
    }

    const mainFile = toRelative(root, fileFor(root, patterns[0], baseLocale));
    const mainWording = new Map();
    for (const [key, { file, message }] of base) {
      if (file === mainFile && typeof message === "string") mainWording.set(message.trim().toLowerCase(), key);
    }
    for (const [key, { file, message }] of base) {
      const existing = file !== mainFile && typeof message === "string" && mainWording.get(message.trim().toLowerCase());
      if (existing) warn(report, file, null, `"${key}" repeats the wording of m.${existing}() -- "${message}"`);
    }
  }

  report.summary = `${allKeys.size} key(s) in ${locales.length} locale(s), ${unused.length} unreferenced`;
  return report;
}
