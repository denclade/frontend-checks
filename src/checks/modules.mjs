// CSS-module references: every `styles.name` (or `styles["name"]`) on an
// imported *.module.scss names a class that module really defines. A typo or
// a class removed from the stylesheet is no compile error -- the element just
// gets class="undefined" and loses its styling silently.
//
// The modules are compiled with the app's own Sass, so classes that come from
// a mixin or from `&__element` nesting are known too. With `localsConvention:
// "camelCase"` a module exports both spellings, so both are accepted.
//
// The other way round, too: a selector string handed to the DOM
// (`closest('.card-actions__menu')`) that names a module class finds nothing
// once the class is scoped -- it has to be built from the module
// (`closest(\`.${styles.cardActionsMenu}\`)`).

import ts from "typescript";
import { createRequire } from "node:module";
import path from "node:path";
import { collectFiles, readText, toRelative } from "../files.mjs";
import { createReport, fail } from "../report.mjs";

const camel = (name) => name.replace(/[-_]+(\w)/g, (_, c) => c.toUpperCase());

function loadSass(root) {
  const require = createRequire(path.join(root, "package.json"));
  for (const name of ["sass-embedded", "sass"]) {
    try {
      return require(name);
    } catch {
      /* try the next */
    }
  }
  return null;
}

function classesOf(sass, file, root, cache) {
  if (cache.has(file)) return cache.get(file);
  const css = sass.compile(file, {
    loadPaths: [path.dirname(file), path.join(root, "src/styles"), path.join(root, "node_modules")],
    quietDeps: true,
    logger: { warn() {}, debug() {} },
  }).css;
  // Selectors only: declaration blocks and strings could hold anything, and
  // what sits in :global(...) or follows a bare :global (a `:global { }`
  // block compiles to that) is not the module's.
  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"[^"]*"|'[^']*'/g, "")
    .replace(/\{[^{}]*\}/g, "{}")
    .replace(/:global\([^()]*\)/g, "")
    .replace(/:global\s[^{,]*/g, "");
  const names = new Set();
  for (const match of selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    names.add(match[1]);
    names.add(camel(match[1]));
  }
  cache.set(file, names);
  return names;
}

const DOM_SELECTOR_CALLS = new Set(["closest", "querySelector", "querySelectorAll", "matches"]);

/** Class names a selector text mentions. */
const selectorClasses = (text) => [...text.matchAll(/(?:^|[\s>+~,(:])\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);

/** The literal parts of a string or template argument. */
function literalTexts(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  return [];
}

/** Every class some module of the app defines, minus those a global stylesheet has as well. */
function moduleOnlyClasses(sass, config, cache, report) {
  const sheets = collectFiles(path.join(config.root, config.srcDir), /\.s?css$/, config.ignoreDirs);
  const local = new Set();
  const global = new Set();
  for (const sheet of sheets) {
    if (/\.module\.scss$/.test(sheet)) {
      try {
        for (const name of classesOf(sass, sheet, config.root, cache)) local.add(name);
      } catch (error) {
        fail(report, toRelative(config.root, sheet), 1, `does not compile: ${String(error.message).split("\n")[0]}`);
      }
    } else {
      for (const name of selectorClasses(readText(sheet).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""))) global.add(name);
    }
  }
  for (const name of global) local.delete(name);
  return local;
}

export async function checkModules(config) {
  const report = createReport("modules");
  const sass = loadSass(config.root);
  if (!sass) {
    report.summary = "skipped -- no sass in the app";
    return report;
  }
  const cache = new Map();
  const files = collectFiles(path.join(config.root, config.srcDir), /\.tsx?$/, config.ignoreDirs);
  const scoped = moduleOnlyClasses(sass, config, cache, report);
  let references = 0;
  let selectors = 0;

  for (const file of files) {
    const rel = toRelative(config.root, file);
    const sf = ts.createSourceFile(file, readText(file), ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const modules = new Map();
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.endsWith(".module.scss") && st.importClause?.name) {
        modules.set(st.importClause.name.text, path.resolve(path.dirname(file), st.moduleSpecifier.text));
      }
    }
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && DOM_SELECTOR_CALLS.has(node.expression.name.text) && node.arguments[0]) {
        selectors++;
        for (const text of literalTexts(node.arguments[0])) {
          for (const name of selectorClasses(text)) {
            if (!scoped.has(name)) continue;
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            fail(report, rel, line, `selector ".${name}" names a CSS-module class -- scoped, it matches nothing; build it from the module (\`.\${styles.${camel(name)}}\`)`);
          }
        }
      }
      let id;
      let name;
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        id = node.expression.text;
        name = node.name.text;
      } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && ts.isStringLiteral(node.argumentExpression)) {
        id = node.expression.text;
        name = node.argumentExpression.text;
      }
      if (id && modules.has(id)) {
        references++;
        const module = modules.get(id);
        let known;
        try {
          known = classesOf(sass, module, config.root, cache);
        } catch (error) {
          fail(report, rel, 1, `${toRelative(config.root, module)} does not compile: ${String(error.message).split("\n")[0]}`);
          modules.delete(id);
          return;
        }
        if (!known.has(name)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          fail(report, rel, line, `${id}.${name} is not a class of ${toRelative(config.root, module)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  report.summary = `${references} reference(s) into ${cache.size} module(s), ${selectors} DOM selector(s)`;
  return report;
}
