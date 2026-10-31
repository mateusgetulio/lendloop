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
function day(value: string) {
  const [year, month, date] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}
function format(value: string, withYear: boolean) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(day(value));
}
export function formatRange(startDate: string, endDate: string) {
  if (startDate === endDate) return format(startDate, true);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${format(startDate, !sameYear)} to ${format(endDate, true)}`;
}
