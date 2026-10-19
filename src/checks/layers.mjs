// Import boundaries between the folders of src/ (frontend concept, 2.1):
//
//   models/core/utils  ->  store  ->  components/routes
//
// Each rule names folders (relative to src/, matched as prefixes) and what
// they must not import. Type-only imports are exempt unless the rule says
// otherwise -- a type costs nothing at runtime. `forbiddenImports` bans a
// package outside the folders allowed to use it (e.g. React outside the one
// island that renders it).
//
// Imports are read from the syntax tree, so multi-line imports, re-exports
// and dynamic import() are all seen.

import ts from "typescript";
import path from "node:path";
import { collectFiles, readText, toRelative } from "../files.mjs";
import { createReport, fail } from "../report.mjs";

const startsWithFolder = (rel, folder) => rel === folder || rel.startsWith(`${folder}/`);

/** Every module specifier in a file, with whether it only brings in types. */
function importsOf(sf) {
  const out = [];
  const add = (node, specifier, typeOnly) => out.push({ specifier, typeOnly, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      add(node, node.moduleSpecifier.text, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      add(node, node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export async function checkLayers(config) {
  const report = createReport("layers");
  const src = path.join(config.root, config.srcDir);
  const { rules, forbiddenImports, exceptions } = config.layers;
  const files = collectFiles(src, /\.(tsx?|jsx?)$/, config.ignoreDirs).filter((f) => !/\.test\.[jt]sx?$/.test(f));

  for (const file of files) {
    const fromSrc = toRelative(src, file);
    const rel = toRelative(config.root, file);
    const sf = ts.createSourceFile(file, readText(file), ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    for (const { specifier, typeOnly, line } of importsOf(sf)) {
      const exempt = exceptions[`${rel}->${specifier}`];
      if (exempt) {
        report.info.push(`KNOWN ${rel}:${line} -> ${specifier} [${exempt}]`);
        continue;
      }

      for (const ban of forbiddenImports) {
        if (ban.module.test(specifier) && !ban.allowIn.some((folder) => startsWithFolder(fromSrc, folder))) {
          fail(report, rel, line, `"${specifier}" may only be imported in ${ban.allowIn.map((f) => `src/${f}`).join(", ")}${ban.why ? ` -- ${ban.why}` : ""}`);
        }
      }

      if (!specifier.startsWith(".")) continue;
      const target = toRelative(src, path.resolve(path.dirname(file), specifier));
      if (target.startsWith("..")) continue;
      for (const rule of rules) {
        if (typeOnly && !rule.includeTypeImports) continue;
        const from = rule.from.find((folder) => startsWithFolder(fromSrc, folder));
        const to = from && rule.forbid.find((folder) => startsWithFolder(target, folder));
        if (to) fail(report, rel, line, `src/${from} must not import from src/${to} ("${specifier}")`);
      }
    }
  }

  report.summary = `${files.length} module(s), ${rules.length} rule(s)`;
  return report;
}
