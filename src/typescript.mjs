import path from "node:path";
import {API} from "typescript/unstable/sync";
import {createVirtualFileSystem} from "typescript/unstable/fs";
import {readText} from "./files.mjs";

/** Parse one batch with the native compiler; release the process before walking ASTs. */
export function parseSourceFiles(files) {
  if (files.length === 0) return new Map();
  const names = [...new Set(files.map(file => path.resolve(file)))];
  const cwd = path.dirname(names[0]);
  const projectFile = path.join(cwd, "__frontend_checks__.json");
  const contents = Object.fromEntries(names.map(file => [file, readText(file)]));
  contents[projectFile] = JSON.stringify({
    compilerOptions: {noLib: true, noResolve: true, types: [], allowJs: true, jsx: "preserve"},
    files: names,
  });
  const api = new API({cwd, fs: createVirtualFileSystem(contents)});
  try {
    const snapshot = api.updateSnapshot({openProjects: [projectFile]});
    try {
      const project = snapshot.getProject(projectFile);
      return new Map(names.map(file => {
        const source = project?.program.getSourceFile(file);
        if (!source) throw new Error(`TypeScript could not parse ${file}`);
        return [file, source];
      }));
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}
