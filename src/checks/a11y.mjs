// Static a11y checks over every .tsx file, walking real JSX syntax trees:
//
// 1. An icon-only button or link with no accessible name -- including one
//    whose only text sits in an element the stylesheet may hide.
// 2. An <img> with no alt attribute (an empty alt is a decision and stays
//    allowed).
// 3. A div/span/li with onClick but no role and tabindex -- a control in
//    disguise that the keyboard cannot reach.
// 4. role="button"/"menuitem" without tabindex -- reachable to a screen
//    reader's virtual cursor, but not to Tab.
//
// Narrow, high-confidence checks, biased toward not flagging: a failure is
// worth trusting. Reviewed exceptions live in the app's config, keyed by
// `path#onClick-source` so they stay attached to their element across
// unrelated edits above it.

import ts from "typescript";
import path from "node:path";
import { collectFiles, readText, toRelative } from "../files.mjs";
import { createReport, fail } from "../report.mjs";

const attribute = (attrs, name) => attrs.find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);
const hasSpread = (attrs) => attrs.some((a) => ts.isJsxSpreadAttribute(a));
const isStringValue = (attr, value) => !!attr?.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === value;

/** Text anywhere inside names the control. Any expression counts: visible
 * text is nearly always a translation call, indistinguishable by shape from
 * an icon expression -- accepting some icon-only ones as false negatives.
 * A nested image with a non-empty alt or an aria-label names it too. */
function hasTextInSubtree(element) {
  let found = false;
  const walk = (node) => {
    if (found) return;
    if (ts.isJsxText(node) && node.text.trim()) found = true;
    else if (ts.isJsxExpression(node) && node.expression) found = true;
    else if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const attrs = node.attributes.properties;
      const alt = attribute(attrs, "alt");
      if ((alt && !isStringValue(alt, "")) || attribute(attrs, "aria-label")) found = true;
    }
    if (!found) ts.forEachChild(node, walk);
  };
  if (ts.isJsxElement(element)) element.children.forEach(walk);
  return found;
}

/** A handler that only stops propagation (a dismiss guard on a popup body)
 * or focuses a ref (clicking a composite input's padding focuses the real
 * control) delegates to something already focusable. */
function isClickGuard(attrs) {
  const text = attribute(attrs, "onClick")?.initializer?.getText() ?? "";
  return /\.stopPropagation\(\)/.test(text) || /\.focus\(\)/.test(text);
}

/** A click-outside-to-dismiss scrim: convenience only, every such surface
 * also has Escape and a real close control. Matched by class name. */
function isBackdrop(attrs) {
  const cls = attribute(attrs, "class") ?? attribute(attrs, "classList");
  return /overlay|backdrop|scrim/i.test(cls?.initializer?.getText() ?? "");
}

export async function checkA11y(config) {
  const report = createReport("a11y");
  const options = config.a11y;
  const iconOnly = new Set(["button", "a", "A", ...options.iconOnlyComponents, ...Object.keys(options.namedByProp)]);
  const hiddenText = options.responsivelyHiddenText;
  const files = collectFiles(path.join(config.root, config.srcDir), /\.tsx$/, config.ignoreDirs).filter((f) => !/\.test\.tsx$/.test(f));
  const known = [];

  for (const file of files) {
    const rel = toRelative(config.root, file);
    const sf = ts.createSourceFile(file, readText(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const report_ = (node, key, message) => {
      if (options.exceptions[key]) known.push(`${rel}:${lineOf(node)}  ${message}  [${options.exceptions[key]}]`);
      else fail(report, rel, lineOf(node), message);
    };

    const inspect = (opening, element, ariaHidden) => {
      const tag = opening.tagName.getText();
      const attrs = opening.attributes.properties;
      const spread = hasSpread(attrs);
      const lineKey = `${rel}:${lineOf(opening)}`;

      if (tag === "img" && !attribute(attrs, "alt") && !spread) {
        report_(opening, lineKey, "<img> without alt");
      }

      if (iconOnly.has(tag) && !ariaHidden && !spread) {
        const ownName = ["aria-label", "aria-labelledby", "title", options.namedByProp[tag]]
          .filter(Boolean)
          .some((name) => attribute(attrs, name) && !isStringValue(attribute(attrs, name), ""));
        const inner = element?.getText() ?? "";
        const onlyHiddenText = hiddenText ? hiddenText.test(inner) : false;
        if (!ownName && (!hasTextInSubtree(element ?? opening) || onlyHiddenText)) {
          report_(opening, lineKey, onlyHiddenText
            ? `<${tag}> is named only by text the stylesheet may hide -- add aria-label`
            : `<${tag}> without an accessible name (no text, title or aria-label)`);
        }
      }

      const role = attribute(attrs, "role");
      const tabIndex = attribute(attrs, "tabIndex") ?? attribute(attrs, "tabindex");
      const focusable = tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || ((tag === "a" || tag === "A") && attribute(attrs, "href"));

      if (["div", "span", "li"].includes(tag) && attribute(attrs, "onClick") && !ariaHidden && !isClickGuard(attrs) && !isBackdrop(attrs) && (!role || !tabIndex)) {
        const clickKey = `${rel}#${attribute(attrs, "onClick").getText().replace(/\s+/g, " ").trim()}`;
        report_(opening, clickKey, `<${tag} onClick> without role and tabindex -- unreachable by keyboard`);
      }

      if (role && ts.isStringLiteral(role.initializer ?? {}) && ["button", "menuitem"].includes(role.initializer.text) && !focusable && !tabIndex) {
        report_(opening, lineKey, `role="${role.initializer.text}" without tabindex -- not reachable via Tab`);
      }
    };

    const visit = (node, ariaHidden) => {
      let hidden = ariaHidden;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        hidden = hidden || isStringValue(attribute(opening.attributes.properties, "aria-hidden"), "true");
        inspect(opening, ts.isJsxElement(node) ? node : null, hidden);
      }
      ts.forEachChild(node, (child) => visit(child, hidden));
    };
    visit(sf, false);
  }

  report.info.push(...known.map((line) => `KNOWN ${line}`));
  report.summary = `${files.length} components${known.length ? `, ${known.length} reviewed exception(s)` : ""}`;
  return report;
}
