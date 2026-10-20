export default {
  contrast: {
    pairs: [["color-text", "color-bg", 4.5], ["color-text-faint", "color-bg", 4.5], ["color-alias", "color-bg", 4.5], ["color-gone", "color-bg", 3]],
    surfaces: [{ files: ["src/components/desk/Status.module.scss"], background: "color-text", why: "drawn on the parent's dark desk" }],
  },
  layers: {
    forbiddenImports: [{ module: /^react(-dom)?(\/|$)/, allowIn: ["island"], why: "React lives in the island" }],
  },
};
