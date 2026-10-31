import { describe, expect, it } from "vitest";
import { tokens } from "../lib/design-tokens";
const c = tokens.color;
function luminance(hex: string) {
  const values = hex
    .slice(1)
    .match(/../g)!
    .map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
const pairs: [string, string, string, number][] = [
  ["text", c.text, c.page, 4.5],
  ["muted", c.muted, c.page, 4.5],
  ["primary", c.white, c.primary, 4.5],
  ["hover", c.white, c.primaryHover, 4.5],
  ["link", c.primary, c.page, 4.5],
  ["danger", c.white, c.danger, 4.5],
  ["border", c.border, c.page, 3],
  ["focus", c.primary, c.page, 3],
  ["success", c.successText, c.successBackground, 4.5],
  ["warning", c.warningText, c.warningBackground, 4.5],
  ["danger badge", c.dangerText, c.dangerBackground, 4.5],
  ["neutral", c.neutralText, c.neutralBackground, 4.5],
  ["info", c.infoText, c.infoBackground, 4.5],
];
describe("DECISIONS.md contrast thresholds", () => {
  it.each(pairs)("%s meets contrast", (_name, fg, bg, minimum) => {
    const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(
      minimum,
    );
  });
});
