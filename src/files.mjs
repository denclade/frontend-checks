import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Every file below `dir` whose name matches `pattern`, skipping the
 * generated and vendored folders the config names. Sorted, so reports are
 * stable between runs. */
export function collectFiles(dir, pattern, ignoreDirs = []) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoreDirs.includes(entry.name)) walk(path.join(current, entry.name));
      } else if (pattern.test(entry.name)) {
        out.push(path.join(current, entry.name));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Path relative to the app root, always with forward slashes -- the form
 * every config key and every report line uses. */
export function toRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

export function readText(file) {
  return readFileSync(file, "utf8");
}

/** 1-based line of a character offset. */
export function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
