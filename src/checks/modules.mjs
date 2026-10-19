// CSS-module references: every `styles.name` (or `styles["name"]`) on an
// imported *.module.scss names a class that module really defines. A typo or
// a class removed from the stylesheet is no compile error -- the element just
// gets class="undefined" and loses its styling silently.
//
// The modules are compiled with the app's own Sass, so classes that come from
// a mixin or from `&__element` nesting are known too. With `localsConvention:
// "camelCase"` a module exports both spellings, so both are accepted.

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
  // Selectors only: declaration blocks and strings could hold anything.
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"]*"|'[^']*'/g, "").replace(/\{[^{}]*\}/g, "{}");
  const names = new Set();
  for (const match of selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    names.add(match[1]);
    names.add(camel(match[1]));
  }
  cache.set(file, names);
  return names;
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
  let references = 0;

  for (const file of files) {
    const rel = toRelative(config.root, file);
    const sf = ts.createSourceFile(file, readText(file), ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const modules = new Map();
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.endsWith(".module.scss") && st.importClause?.name) {
        modules.set(st.importClause.name.text, path.resolve(path.dirname(file), st.moduleSpecifier.text));
      }
    }
    if (modules.size === 0) continue;

    const visit = (node) => {
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

  report.summary = `${references} reference(s) into ${cache.size} module(s)`;
  return report;
}
