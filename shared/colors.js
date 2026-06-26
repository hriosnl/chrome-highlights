// 5 highlight hues with per-theme bg + text pairs
const HIGHLIGHT_COLORS = [
  {
    name: "amber",
    light: { bg: "#F8F2AF", text: "#3D2E00" },
    dark: { bg: "#8C7C50", text: "#FFF8E1" },
  },
  {
    name: "mint",
    light: { bg: "#A8E6CF", text: "#1A3D2E" },
    dark: { bg: "#2D6B52", text: "#E8FFF5" },
  },
  {
    name: "coral",
    light: { bg: "#FFB4A2", text: "#4A2018" },
    dark: { bg: "#9E4A3A", text: "#FFEDE8" },
  },
  {
    name: "sky",
    light: { bg: "#90CAF9", text: "#0D2A47" },
    dark: { bg: "#2E6B9E", text: "#E3F2FD" },
  },
  {
    name: "lavender",
    light: { bg: "#CE93D8", text: "#3D1F47" },
    dark: { bg: "#6B3D7A", text: "#F3E5F5" },
  },
];

function getColorPair(colorIndex, isDark) {
  const color = HIGHLIGHT_COLORS[colorIndex] || HIGHLIGHT_COLORS[0];
  return isDark ? color.dark : color.light;
}

if (typeof globalThis !== "undefined") {
  globalThis.HIGHLIGHT_COLORS = HIGHLIGHT_COLORS;
  globalThis.getColorPair = getColorPair;
}
