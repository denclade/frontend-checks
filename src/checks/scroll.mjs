// A flex item that scrolls (`flex: 1` + `overflow(-y): auto|scroll`) needs
// an explicit min-height as well: its default minimum is `auto`, so it
// grows to fit all its content instead of scrolling, and the excess is
// clipped by the next ancestor with `overflow: hidden`.
//
// Any explicit min-height fixes it (not only 0), and so does a max-height,
// which bounds the box from the other side. `@include scroll-fill` bundles
// the trio and is the recommended fix for everything this reports.

import path from "node:path";
import { collectFiles, readText, toRelative } from "../files.mjs";
import { createReport, fail } from "../report.mjs";
import { flattenSelector, parseRules } from "../scss.mjs";

export async function checkScroll(config) {
  const report = createReport("scroll");
  const files = collectFiles(path.join(config.root, config.srcDir), /\.scss$/, config.ignoreDirs);

  for (const file of files) {
    const rel = toRelative(config.root, file);
    for (const rule of parseRules(readText(file))) {
      if (rule.includes.includes("scroll-fill")) continue;
      const { decls } = rule;
      const flexItem = /^1\b/.test(decls.flex ?? "") || /^1\b/.test(decls["flex-grow"] ?? "");
      // `overflow: x y` -- with one value it applies to both axes.
      const [overflowX, overflowY = overflowX] = (decls.overflow ?? "").split(/\s+/);
      const scrolls = /^(auto|scroll)\b/.test(decls["overflow-y"] ?? overflowY ?? "");
      if (flexItem && scrolls && !decls["min-height"] && !decls["max-height"]) {
        const selector = flattenSelector(rule.chain) ?? rule.chain.join(" ");
        fail(report, rel, rule.line, `"${selector}" scrolls as a flex item without min-height: 0 -- use @include scroll-fill`);
      }
    }
  }

  report.summary = `${files.length} stylesheet(s)`;
  return report;
}
