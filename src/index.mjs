import { checkA11y } from "./checks/a11y.mjs";
import { checkContrast } from "./checks/contrast.mjs";
import { checkI18n } from "./checks/i18n.mjs";
import { checkLayers } from "./checks/layers.mjs";
import { checkScroll } from "./checks/scroll.mjs";
import { checkStyles } from "./checks/styles.mjs";

export { loadConfig, DEFAULT_LAYER_RULES } from "./config.mjs";
export { print } from "./report.mjs";

/** Name on the command line -> check. The order is the order `all` runs. */
export const CHECKS = {
  a11y: checkA11y,
  contrast: checkContrast,
  styles: checkStyles,
  scroll: checkScroll,
  i18n: checkI18n,
  layers: checkLayers,
};
