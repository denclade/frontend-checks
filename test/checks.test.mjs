import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CHECKS, loadConfig } from "../src/index.mjs";
import { customPropertiesOf } from "../src/scss.mjs";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/app");
const config = await loadConfig(FIXTURE);
const run = (name) => CHECKS[name](config);
const has = (lines, ...parts) => lines.some((line) => parts.every((part) => line.includes(part)));

test("a11y: unnamed icon button, img without alt, click-only div, role without tabindex", async () => {
  const { failures } = await run("a11y");
  assert.ok(has(failures, "Thing.tsx:5", "<button> without an accessible name"));
  assert.ok(!has(failures, "Thing.tsx:6"), "a title names the button");
  assert.ok(has(failures, "Thing.tsx:7", "<img> without alt"));
  assert.ok(has(failures, "Thing.tsx:8", "<div onClick>"));
  assert.ok(has(failures, "Thing.tsx:9", 'role="button" without tabindex'));
  assert.equal(failures.length, 4);
});

test("contrast: token pairs in both themes, aliases resolve, unknown tokens fail, same-rule pairs", async () => {
  const { failures, info } = await run("contrast");
  assert.ok(has(info, "OK light: color-text on color-bg"));
  assert.ok(has(info, "OK dark: color-alias on color-bg"), "alias from variables.scss resolves per theme");
  assert.ok(has(failures, "light: color-text-faint on color-bg"));
  assert.ok(has(failures, "dark: color-text-faint on color-bg"));
  assert.ok(has(failures, "light: color-gone does not resolve"));
  assert.ok(has(failures, "main.scss:18", ".pair"), "same-rule pair is measured");
});

test("styles: unresolved import, unjustified literals, token-sized px, undefined var", async () => {
  const { failures } = await run("styles");
  assert.ok(has(failures, "main.scss:2", '"missing-partial" does not resolve'));
  assert.ok(!has(failures, "main.scss:1:"), "existing partial resolves");
  assert.ok(has(failures, "main.scss:4", "8px instead of var(--space-2)"));
  assert.ok(!has(failures, "main.scss:5"), "3px is no token size");
  assert.ok(has(failures, "main.scss:6", "colour literal"));
  assert.ok(!has(failures, "main.scss:8"), "a comment above justifies a literal");
  assert.ok(has(failures, "main.scss:9", "var(--color-undefined) is defined nowhere"));
  assert.ok(has(failures, "main.scss:19", "colour literal"));
  assert.ok(!has(failures, "main.scss:20"), "a comment on the line justifies a literal");
  assert.ok(!has(failures, "_theme-colors.scss"), "the theme is where colours live");
  assert.ok(!has(failures, "variables.scss"), "role tokens may name a colour");
  assert.ok(!has(failures, "main.scss:23"), "a colour derived from a token is no literal");
  assert.ok(!has(failures, "main.scss:27") && !has(failures, "main.scss:28"), "one comment justifies the block of literals below it");
  assert.ok(has(failures, "main.scss:30", "colour literal"), "... but not past an unrelated line");
});

test("scroll: flex item that scrolls without min-height, mixin is fine", async () => {
  const { failures } = await run("scroll");
  assert.deepEqual(failures.map((f) => f.split("  ")[0]), ["src/styles/main.scss:11"]);
});

test("i18n: parity, placeholders, missing keys used in code, unused as warning", async () => {
  const { failures, warnings } = await run("i18n");
  assert.ok(has(failures, '"only_en" has no de translation'));
  assert.ok(has(failures, '"greeting" uses {} in de but {name} in en'));
  assert.ok(has(failures, "Thing.tsx:10", "m.missing_key has no message"));
  assert.ok(has(warnings, '"unused_key" is never referenced'));
  assert.ok(!has(warnings, '"greeting"'));
});

test("layers: pure code may not import state or UI, type imports pass, banned packages", async () => {
  const { failures } = await run("layers");
  assert.ok(has(failures, "utils/helper.ts:1", "src/utils must not import from src/store"));
  assert.ok(!has(failures, "utils/helper.ts:2"), "type-only import is exempt");
  assert.ok(has(failures, "utils/helper.ts:3", "src/utils must not import from src/components"), "multi-line import is seen");
  assert.ok(has(failures, "components/ui/Thing.tsx:2", "src/components/ui must not import from src/routes"));
  assert.ok(has(failures, "store/data.ts:1", '"react" may only be imported in src/island'));
});

test("tokens: a palette mixin of the same file counts as written in the theme, own declarations win", () => {
  const source = `
@mixin palette { --blue: oklch(50% 0.2 250); --text: black; }
:root { @include palette; --text: oklch(20% 0 0); --link: var(--blue); }`;
  assert.deepEqual(customPropertiesOf(source, (selector) => selector === ":root"), {
    blue: "oklch(50% 0.2 250)",
    text: "oklch(20% 0 0)",
    link: "var(--blue)",
  });
});
