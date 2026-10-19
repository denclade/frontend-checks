// Colour math for the contrast check.
//
// OKLCH -> OKLab -> linear sRGB -> WCAG relative luminance -> ratio, the
// same conversion browsers and CSS Color 4 use; see
// https://bottosson.github.io/posts/oklab/ for the matrices.

export function oklchToLinearSrgb(L, C, hueDegrees) {
  const h = (hueDegrees * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function srgbByteToLinear(byte) {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(c) {
  const v = clamp01(c);
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(s) * 255);
}

export function toHex({ r, g, b }) {
  return `#${[r, g, b].map(linearToSrgbByte).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

export function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const [high, low] = a >= b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

const NAMED = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
};

/** One CSS colour value as linear sRGB, or null when it is not a plain
 * opaque colour this tool can reason about (gradients, currentColor,
 * inherit, anything translucent whose result depends on what is behind it,
 * unknown tokens). Null means "skip", never "fails". `tokens` maps a token
 * name without the leading dashes to its linear colour. */
export function parseColor(rawValue, tokens = {}) {
  if (!rawValue) return null;
  let value = String(rawValue).replace(/!important/gi, "").trim().toLowerCase();
  if (!value) return null;

  const variable = value.match(/^var\(\s*--([a-z0-9-]+)\s*(?:,([\s\S]+))?\)$/i);
  if (variable) {
    if (tokens[variable[1]]) return tokens[variable[1]];
    return variable[2] ? parseColor(variable[2], tokens) : null;
  }

  if (NAMED[value]) value = NAMED[value];

  const hex = value.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    let parts;
    if (digits.length === 3 || digits.length === 4) parts = [...digits].map((d) => d + d);
    else if (digits.length === 6 || digits.length === 8) parts = digits.match(/.{2}/g);
    else return null;
    if (parts.length === 4 && parseInt(parts[3], 16) !== 255) return null;
    const [r, g, b] = parts.slice(0, 3).map((p) => srgbByteToLinear(parseInt(p, 16)));
    return { r, g, b };
  }

  const oklch = value.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(\/\s*([\d.]+)(%?))?\s*\)$/);
  if (oklch) {
    if (oklch[4]) {
      const alpha = parseFloat(oklch[5]) / (oklch[6] ? 100 : 1);
      if (alpha !== 1) return null;
    }
    return oklchToLinearSrgb(parseFloat(oklch[1]) / 100, parseFloat(oklch[2]), parseFloat(oklch[3]));
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    if (parts.length === 4 && parseFloat(parts[3]) !== 1) return null;
    const [r, g, b] = parts.slice(0, 3).map((p) => srgbByteToLinear(parseFloat(p)));
    return { r, g, b };
  }

  return null;
}
