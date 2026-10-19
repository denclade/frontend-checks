// Just enough SCSS understanding for the checks: rules with their nesting
// chain and declarations, and the custom properties of one block. Not a
// real parser -- the stylesheets these apps write are flat enough that a
// brace walker sees what matters, and a check that guesses is skipped
// rather than reported.

import { oklchToLinearSrgb } from "./color.mjs";

/** Comments blanked out character by character, so offsets and line
 * numbers still match the original source. `//` only counts as a comment
 * outside a `url(...)` / string, which is where `https://` lives. */
export function stripComments(source) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === quote && source[i - 1] !== "\\") quote = null;
      i++;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (ch === "/" && next === "/" && source[i - 1] !== ":") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** One entry per `{ }` block: its chain of enclosing selectors, its own
 * declarations (lower-cased property -> raw value), whether it nests
 * further blocks, and the line it starts on. Interpolation `#{...}` is
 * kept inside the selector/value it belongs to. */
export function parseRules(source) {
  const src = stripComments(source);
  const rules = [];
  const stack = [];
  let buf = "";
  let bufLine = 1;
  let line = 1;
  let interpolation = 0;

  const append = (text) => {
    if (!buf.trim() && text.trim()) bufLine = line;
    buf += text;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "#" && src[i + 1] === "{") {
      interpolation++;
      append("#{");
      i++;
      continue;
    }
    if (interpolation > 0) {
      if (ch === "}") interpolation--;
      append(ch);
      continue;
    }
    if (ch === "{") {
      if (stack.length) stack[stack.length - 1].hasChildren = true;
      stack.push({ selector: buf.trim(), decls: {}, includes: [], line: bufLine, hasChildren: false });
      buf = "";
    } else if (ch === "}") {
      flushDeclaration(stack, buf);
      const rule = stack.pop();
      if (rule) rules.push({ chain: [...stack.map((s) => s.selector), rule.selector], decls: rule.decls, includes: rule.includes, hasChildren: rule.hasChildren, line: rule.line });
      buf = "";
    } else if (ch === ";") {
      flushDeclaration(stack, buf);
      buf = "";
    } else {
      append(ch);
    }
    if (ch === "\n") line++;
  }
  return rules;
}

function flushDeclaration(stack, raw) {
  const decl = raw.trim();
  if (!decl || !stack.length) return;
  const rule = stack[stack.length - 1];
  const include = decl.match(/^@include\s+([\w.-]+)/);
  if (include) {
    rule.includes.push(include[1].split(".").pop());
    return;
  }
  const colon = decl.indexOf(":");
  if (colon > 0 && !decl.startsWith("@")) {
    rule.decls[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).trim();
  }
}

/** `.a { &:hover { } }` -> ".a:hover". `@media`/`@supports` wrappers and
 * breakpoint mixins (`@include phone { }`) are transparent; anything in a
 * mixin or keyframes definition has no selector and yields null. */
export function flattenSelector(chain) {
  let current = null;
  for (const raw of chain) {
    const segment = raw.trim();
    if (!segment) continue;
    if (segment.startsWith("@")) {
      if (/^@(mixin|keyframes|function|each|for|while|if|else)/i.test(segment)) return null;
      continue;
    }
    if (segment.includes("&")) current = segment.replace(/&/g, current ?? "");
    else current = current ? `${current} ${segment}` : segment;
  }
  return current;
}

/** The custom properties declared directly in the first block whose
 * selector satisfies `matches` (`--name` without dashes -> raw value). */
export function customPropertiesOf(source, matches) {
  const tokens = {};
  for (const rule of parseRules(source)) {
    const own = rule.chain[rule.chain.length - 1];
    if (rule.chain.length !== 1 || !matches(own)) continue;
    for (const [name, value] of Object.entries(rule.decls)) {
      if (name.startsWith("--")) tokens[name.slice(2)] = value;
    }
  }
  return tokens;
}

/** Raw token values resolved to linear colours through any number of
 * `var(--x)` aliases. Tokens that end in something other than a plain
 * oklch() colour are left out -- a check then reports them as unknown. */
export function resolveColorTokens(raw) {
  const resolved = {};
  const resolve = (name, seen = new Set()) => {
    if (name in resolved) return resolved[name];
    if (seen.has(name)) return null;
    seen.add(name);
    const value = raw[name];
    if (value === undefined) return null;
    const alias = value.match(/^var\(\s*--([\w-]+)\s*\)$/);
    if (alias) return resolve(alias[1], seen);
    const oklch = value.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/);
    return oklch ? oklchToLinearSrgb(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3])) : null;
  };
  for (const name of Object.keys(raw)) {
    const color = resolve(name);
    if (color) resolved[name] = color;
  }
  return resolved;
}
