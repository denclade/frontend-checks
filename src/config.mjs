import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONFIG_FILE = "frontend-checks.config.mjs";

/** The layer rule from the frontend concept (section 2.1): pure code knows
 * nothing about state or UI, state knows nothing about UI. Type-only
 * imports cross freely -- they cost nothing at runtime. */
export const DEFAULT_LAYER_RULES = [
  { from: ["models", "core", "utils"], forbid: ["store", "components", "routes"] },
  { from: ["store"], forbid: ["components", "routes"] },
  { from: ["components/ui"], forbid: ["routes"], includeTypeImports: true },
];

const DEFAULTS = {
  srcDir: "src",
  ignoreDirs: ["paraglide", "generated", "node_modules"],
  stylesDir: "src/styles",
  themeFile: "src/styles/_theme-colors.scss",
  variablesFile: "src/styles/variables.scss",
  themes: { light: "light-theme-vars", dark: "dark-theme-vars" },
  a11y: {
    iconOnlyComponents: ["IconButton"],
    // The UI family names an icon-only button by its label prop (see
    // frontend-konzept.md, 2.3).
    namedByProp: { IconButton: "label" },
    responsivelyHiddenText: null,
    exceptions: {},
  },
  contrast: {
    pairs: [],
    exceptions: {},
    extraPairs: () => [],
    derived: true,
  },
  styles: {
    colorSources: [],
    foreign: [],
    externalProperties: [],
    literals: true,
  },
  i18n: {
    sourceDirs: ["src"],
    dynamicKeys: [],
    featureMessagesDir: null,
  },
  layers: {
    rules: DEFAULT_LAYER_RULES,
    forbiddenImports: [],
    exceptions: {},
  },
};

/** Shallow per-section merge: an app overrides whole options, never parts
 * of an option, so what a config says is exactly what applies. `themes` is one
 * option, not a section: an app names exactly the themes it has. */
const WHOLE = new Set(["themes"]);

function merge(defaults, overrides) {
  const out = { ...defaults };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const base = defaults[key];
    const isSection = !WHOLE.has(key) && base && typeof base === "object" && !Array.isArray(base) && value && typeof value === "object" && !Array.isArray(value);
    out[key] = isSection ? { ...base, ...value } : value;
  }
  return out;
}

export async function loadConfig(dir = process.cwd()) {
  const root = path.resolve(dir);
  const file = path.join(root, CONFIG_FILE);
  const own = existsSync(file) ? (await import(pathToFileURL(file).href)).default : {};
  const config = merge(DEFAULTS, own);
  config.root = root;
  // The theme defines the colours, variables.scss maps roles onto them.
  config.styles.colorSources = [config.themeFile, config.variablesFile, ...config.styles.colorSources];
  return config;
}
