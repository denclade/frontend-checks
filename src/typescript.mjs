import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";

const ROOT = "/__frontend_checks__";
let parser;

function createParser() {
  const fs = createVirtualFileSystem({
    [`${ROOT}/tsconfig.json`]: JSON.stringify({
      compilerOptions: { noLib: true, noResolve: true, types: [], allowJs: true, jsx: "preserve" },
      include: ["*.ts", "*.tsx"],
    }),
    [`${ROOT}/input.ts`]: "",
    [`${ROOT}/input.tsx`]: "",
  });
  // Checks need syntax only: keep imports, libraries and the app's tsconfig out of the native project.
  const api = new API({ fs: {
    ...fs,
    readFile: (file) => fs.readFile(file) ?? null,
    getAccessibleEntries: (directory) => fs.getAccessibleEntries(directory) ?? { files: [], directories: [] },
  } });
  return { fs, api, sequence: 0, previous: undefined };
}

/** Parses one isolated source, preserving its original character and line positions. */
export function parseSourceFile(fileName, text) {
  parser ??= createParser();
  // Open-file contents are immutable in a native snapshot; use a fresh virtual path for each parse.
  const file = `${ROOT}/input-${++parser.sequence}.${/x$/.test(fileName) ? "tsx" : "ts"}`;
  const previous = parser.previous;
  if (previous) parser.fs.removeFile(previous);
  parser.fs.writeFile(file, text);
  const snapshot = parser.api.updateSnapshot({
    openFiles: [file], closeFiles: previous ? [previous] : [],
    fileChanges: { created: [file], deleted: previous ? [previous] : [] },
  });
  parser.previous = file;
  try {
    const source = snapshot.getDefaultProjectForFile(file)?.program.getSourceFile(file);
    if (!source) throw new Error(`TypeScript could not parse ${fileName}`);
    return source;
  } finally {
    snapshot.dispose();
  }
}

export function closeParser() {
  parser?.api.close();
  parser = undefined;
}
