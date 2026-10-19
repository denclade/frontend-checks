export default {
  contrast: {
    pairs: [["color-text", "color-bg", 4.5], ["color-text-faint", "color-bg", 4.5], ["color-alias", "color-bg", 4.5], ["color-gone", "color-bg", 3]],
  },
  layers: {
    forbiddenImports: [{ module: /^react(-dom)?(\/|$)/, allowIn: ["island"], why: "React lives in the island" }],
  },
};
