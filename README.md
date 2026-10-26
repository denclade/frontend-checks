# @dencla/frontend-checks

## Runtime and compiler API

Version 0.2 requires Node 26 and TypeScript 7.0.2. The AST checks use
`typescript/unstable/ast` and the native synchronous API, pinned to an exact
version because those interfaces are unstable. Each check parses one virtual
project without resolving imports or loading libraries, closes the compiler,
and inspects the decoded source trees. No older TypeScript compiler is retained.

Run `pnpm install --frozen-lockfile` and `pnpm test` here to validate the tool
independently. Tests run in one process for the native synchronous RPC transport.
Use the pnpm lockfile; a second npm lockfile is not maintained.

Shared static checks across SolidJS frontends.

| Check      | Description |
|------------|-------------|
| `a11y`     | Unnamed icon buttons/links, `<img>` without `alt`, `div`/`span`/`li` with `onClick` missing role + tabindex, `role="button"` missing tabindex |
| `contrast` | 3 phases per theme: token pairs, color + background within the same SCSS rule, text against the JSX parent's background |
| `modules`  | Every `styles.x` reference to an imported `*.module.scss` exists (compiled with the app's Sass) — preventing `class="undefined"`; no DOM selector strings (`closest`, `querySelector`, `matches`) or plain class names (`class="x"`, `classList` keys, `el.classList.add("x")`) referencing scoped module classes that would fail to match |
| `styles`   | `@use`/`@import` resolve properly; no color literals outside color source files and no `px` spacing/radii where a token exists (unless justified via comment); no undefined `var(--x)` |
| `scroll`   | Scrolling flex children missing `min-height` (→ `@include scroll-fill`) |
| `i18n`     | Key and placeholder parity across all locales, keys used in code exist, duplicate keys; unused keys reported as warnings |
| `layers`   | `models`/`core`/`utils`/`api` → `store` → `components`/`routes`, `components/ui` ↛ `routes`; forbidden packages outside allowed directories |

## Installation

Add as a Git submodule in the app root and link via `file:`:

```sh
git submodule add https://github.com/denclade/frontend-checks.git frontend-checks
```

```jsonc
// App package.json
"devDependencies": { "@dencla/frontend-checks": "file:./frontend-checks" },
"scripts": {
  "check:a11y": "frontend-checks a11y",
  // …
  "check:frontend": "frontend-checks all"
}
```

The app's `install` recipe fetches the submodule (`git submodule update --init`). To update checks: check out the new state in the submodule and commit the updated reference in the app. App test runners (Vitest) must exclude `frontend-checks/**`; tests here run via `node --test`.

## Configuration

Place `frontend-checks.config.mjs` in the app root (defaults in [`src/config.mjs`](src/config.mjs)). Each section only overrides the specified options:

```js
export default {
  a11y: {
    iconOnlyComponents: ["IconButton"],          // Components without visible text
    namedByProp: { Tooltip: "label" },           // Component -> prop that provides its accessible name
    exceptions: { "src/x.tsx#onClick={…}": "Reason" },
  },
  contrast: {
    pairs: [["color-text", "color-bg", 4.5]],    // [foreground, background, minimum]
    exceptions: { "light:fg:bg": { min: 4.0, reason: "…" } },
    extraPairs: (tokens) => [],                  // Pairs derived from tokens
    // Stylesheets whose rules sit on an ancestor's background (e.g. a bar on a dark canvas):
    // their text colors are checked against this token.
    surfaces: [{ files: ["src/…/Status.module.scss"], background: "color-desk", why: "…" }],
  },
  styles: {
    colorSources: ["src/styles/_syntax-colors.scss"], // Allowed to contain color literals
    foreign: ["src/styles/libs/"],                // Third-party (libraries, iframe styles): unchecked
    externalProperties: ["cm-gutter-width"],      // Custom properties from external libraries
  },
  i18n: { dynamicKeys: [/^error_/], featureMessagesDir: "src/features" },
  layers: {
    forbiddenImports: [{ module: /^react(-dom)?(\/|$)/, allowIn: ["diagram/island"], why: "…" }],
    exceptions: { "src/a.ts->../store/b": "Reason" },
  },
};
```

Justified exceptions belong in the configuration rather than inline code comments, keeping them visible in a single place. The only exception: intentional color or `px` literals are commented directly on the same line (`// Logo color, not themeable`).

## Development

```sh
pnpm install --frozen-lockfile
pnpm test        # runs node --test against test/fixtures/app
```
