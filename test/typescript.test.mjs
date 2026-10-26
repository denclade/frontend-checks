import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as ts from "typescript/unstable/ast";
import { parseSourceFile, closeParser } from "../src/typescript.mjs";

after(closeParser);

test("native parsing preserves JSX, type-only imports and source positions", () => {
  const source = '\nimport type { Foo } from "./missing";\nconst view = <button aria-label="Name">Text</button>;';
  const sf = parseSourceFile("View.tsx", source);
  assert.equal(sf.statements[0].importClause.phaseModifier, ts.SyntaxKind.TypeKeyword);
  const buttons = [];
  const visit = node => {
    if (ts.isJsxOpeningElement(node)) buttons.push(node);
    node.forEachChild(visit);
  };
  visit(sf);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].tagName.getText(), "button");
  assert.equal(sf.getLineAndCharacterOfPosition(buttons[0].getStart(sf)).line, 2);
});

test("reusing the virtual input never returns a stale source", () => {
  const first = parseSourceFile("one.ts", 'export const value = "old";');
  const second = parseSourceFile("two.ts", 'export const value = "new";');
  assert.equal(first.text, 'export const value = "old";');
  assert.equal(second.text, 'export const value = "new";');
  assert.match(second.statements[0].getText(), /new/);
  closeParser();
  assert.match(parseSourceFile("after-close.ts", "const reopened = 1;").text, /reopened/);
});
