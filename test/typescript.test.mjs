import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import * as ts from "typescript/unstable/ast";
import {parseSourceFiles} from "../src/typescript.mjs";

test("native parsing preserves JSX, type-only imports and Unicode positions after closing the compiler", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "frontend-checks-ast-"));
  try {
    const file = path.join(dir, "Example.tsx");
    const source = '// 🙂\r\nimport type {Value} from "./value";\r\nconst ui = <button aria-label="Öffnen">Ä</button>;';
    writeFileSync(file, source);
    const trees = parseSourceFiles([file, file]);
    assert.equal(trees.size, 1, "duplicate paths are parsed once");
    const sf = trees.get(file);
    assert.equal(sf.statements[0].importClause.isTypeOnly, true);
    const attributes = [];
    const visit = node => {
      if (ts.isJsxAttribute(node)) attributes.push(node);
      node.forEachChild(visit);
    };
    visit(sf);
    assert.equal(attributes[0].getText(), 'aria-label="Öffnen"');
    assert.equal(attributes[0].getStart(sf), source.indexOf("aria-label"));
    assert.equal(sf.getLineAndCharacterOfPosition(attributes[0].getStart(sf)).line, 2);
    writeFileSync(file, 'export const changed = "new";');
    assert.match(parseSourceFiles([file]).get(file).getText(), /changed/,
      "a later batch must not reuse stale source data");
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test("an empty source batch needs no compiler process", () => {
  assert.equal(parseSourceFiles([]).size, 0);
});

test("missing input fails instead of silently dropping a check", () => {
  assert.throws(() => parseSourceFiles([path.join(tmpdir(), "missing-frontend-check.ts")]));
});
