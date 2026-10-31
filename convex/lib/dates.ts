import { ConvexError } from "convex/values";
export function calendarDay(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function today() {
  return calendarDay(Date.now(), process.env.APP_TIMEZONE ?? "UTC");
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function validateRange(startDate: string, endDate: string, day: string) {
  if (!validDate(startDate) || !validDate(endDate))
    throw new ConvexError("Enter valid start and end dates.");
  if (startDate < day)
    throw new ConvexError("Start date must be today or later.");
  if (endDate < startDate)
    throw new ConvexError("End date must be on or after the start date.");
}
