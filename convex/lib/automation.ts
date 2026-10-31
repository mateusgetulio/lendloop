import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { calendarDay } from "./dates";
export function backoff() {
  const delays = (
    process.env.AUTOMATION_BACKOFF_SECONDS ?? "60,120,240,480,120"
  )
    .split(",")
    .map(Number);
  if (
    delays.length !== 5 ||
    delays.some((d) => !Number.isInteger(d) || d < 1 || d > 86400)
  )
    throw new Error("Invalid retry configuration");
  return delays;
}
export async function failure(
  ctx: MutationCtx,
  input: { key: string; source: string; reference: string; message: string },
) {
  if (
    await ctx.db
      .query("automationFailures")
      .withIndex("by_key", (q) => q.eq("key", input.key))
      .unique()
  )
    return "duplicate";
  await ctx.db.insert("automationFailures", {
    ...input,
    createdAt: Date.now(),
  });
  return "recorded";
}
export async function missingReminders(ctx: QueryCtx, day: string) {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_status_endDate", (q) =>
      q.eq("status", "approved").lt("endDate", day),
    )
    .collect();
  const missing = [];
  for (const loan of loans) {
    if (
      !(await ctx.db
        .query("notifications")
        .withIndex("by_key", (q) => q.eq("key", `overdue:${loan._id}:${day}`))
        .unique())
    )
      missing.push(loan);
  }
  return missing;
}
export async function refreshCalendar(ctx: MutationCtx, now: number) {
  const timezone = process.env.APP_TIMEZONE ?? "UTC",
    day = calendarDay(now, timezone);
  let state = await ctx.db
    .query("systemState")
    .withIndex("by_key", (q) => q.eq("key", "calendar"))
    .unique();
  if (!state) {
    const id = await ctx.db.insert("systemState", {
      key: "calendar",
      today: day,
    });
    state = await ctx.db.get(id);
  } else if (state.today !== day) await ctx.db.patch(state._id, { today: day });
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const minutes =
    Number(parts.find((p) => p.type === "hour")!.value) * 60 +
    Number(parts.find((p) => p.type === "minute")!.value);
  if (state && minutes >= 630 && state.lastHealthCheckDate !== day) {
    if (state.lastOverdueFetchDate !== day)
      await failure(ctx, {
        key: `reminder-run-missing:${day}`,
        source: "reminder-run-missing",
        reference: day,
        message: "The scheduled reminder fetch has not run today.",
      });
    if ((await missingReminders(ctx, day)).length)
      await failure(ctx, {
        key: `reminders-incomplete:${day}`,
        source: "reminders-incomplete",
        reference: day,
        message: "Some overdue loans have no reminder for today.",
      });
    await ctx.db.patch(state._id, { lastHealthCheckDate: day });
  }
}
export async function retryEvent(
  ctx: MutationCtx,
  eventId: Id<"automationEvents">,
) {
  const event = await ctx.db.get(eventId);
  if (!event || event.state !== "failed") return false;
  await ctx.db.patch(eventId, {
    state: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: undefined,
    updatedAt: Date.now(),
  });
  return true;
}
