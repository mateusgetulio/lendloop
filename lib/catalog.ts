export const categories = [
  "power_tools",
  "garden",
  "kitchen",
  "camping",
  "other",
] as const;
export const conditions = ["like_new", "good", "fair"] as const;
export const label = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export function overlaps(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
