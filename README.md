# @dencla/frontend-checks

Die statischen Prüfungen, die alle vier SolidJS-Frontends (`nobo`, `einfachmalab`,
`code.dencla.de`, `zurnote.de`) laut Frontend-Konzept (Abschnitt 2.6) gemeinsam haben –
einmal implementiert statt viermal kopiert.

| Check      | Prüft |
|------------|-------|
| `a11y`     | Icon-Buttons/Links ohne Namen, `<img>` ohne `alt`, `div`/`span`/`li` mit `onClick` ohne Rolle+Tabindex, `role="button"` ohne Tabindex |
| `contrast` | 3 Phasen in jedem Theme: Token-Paare, Farbe+Hintergrund derselben SCSS-Regel, Text auf dem Hintergrund des JSX-Elternelements |
| `modules`  | Jede `styles.x`-Referenz auf ein importiertes `*.module.scss` existiert dort (mit der Sass der App kompiliert) — sonst `class="undefined"`; kein DOM-Selektor-String (`closest`, `querySelector`, `matches`) nennt eine Modulklasse, die gescoped nichts mehr trifft |
| `styles`   | `@use`/`@import` lösen auf; keine Farbliterale außerhalb der Farbquellen und keine px-Abstände/-Radien, für die es ein Token gibt (jeweils ohne Begründungskommentar); keine undefinierten `var(--x)` |
| `scroll`   | Scrollendes Flex-Kind ohne `min-height` (→ `@include scroll-fill`) |
| `i18n`     | Schlüssel- und Platzhalter-Parität aller Locales, im Code benutzte Schlüssel existieren, doppelte Schlüssel; unbenutzte als Warnung |
| `layers`   | `models`/`core`/`utils` → `store` → `components`/`routes`, `components/ui` ↛ `routes`; verbotene Pakete außerhalb erlaubter Ordner |

## Einbinden

```jsonc
// package.json der App
"devDependencies": { "@dencla/frontend-checks": "file:../frontend-checks" },
"scripts": {
  "check:a11y": "frontend-checks a11y",
  // …
  "check:frontend": "frontend-checks all"
}
```

Sobald das Repo einen Remote hat, `file:../frontend-checks` durch
`git+ssh://<remote>/frontend-checks.git#v0.1.0` ersetzen.

## Konfiguration

`frontend-checks.config.mjs` im App-Root, Standardwerte in [`src/config.mjs`](src/config.mjs).
Jeder Abschnitt überschreibt nur die Optionen, die er nennt:

```js
export default {
  a11y: {
    iconOnlyComponents: ["IconButton"],          // Komponenten ohne sichtbaren Text
    namedByProp: { Tooltip: "label" },           // Komponente -> Prop, die sie benennt
    exceptions: { "src/x.tsx#onClick={…}": "Begründung" },
  },
  contrast: {
    pairs: [["color-text", "color-bg", 4.5]],    // [Vordergrund, Hintergrund, Minimum]
    exceptions: { "light:fg:bg": { min: 4.0, reason: "…" } },
    extraPairs: (tokens) => [],                  // aus den Tokens abgeleitete Paare
  },
  styles: {
    colorSources: ["src/styles/_syntax-colors.scss"], // dürfen Farbliterale enthalten
    foreign: ["src/styles/libs/"],                // Fremdes (Bibliotheken, iframe-Styles): ungeprüft
    externalProperties: ["cm-gutter-width"],      // Custom Properties aus Bibliotheken
  },
  i18n: { dynamicKeys: [/^error_/], featureMessagesDir: "src/features" },
  layers: {
    forbiddenImports: [{ module: /^react(-dom)?(\/|$)/, allowIn: ["diagram/island"], why: "…" }],
    exceptions: { "src/a.ts->../store/b": "Begründung" },
  },
};
```

Begründete Ausnahmen gehören in die Konfiguration, nicht in Kommentare im Code –
so bleiben sie an einer Stelle sichtbar. Einzige Ausnahme: ein bewusstes Farb- oder
px-Literal wird direkt daneben kommentiert (`// Logo-Farbe, nicht themebar`).

## Entwicklung

```sh
npm install
npm test        # node --test gegen test/fixtures/app
```
