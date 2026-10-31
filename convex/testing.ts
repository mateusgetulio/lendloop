import { internalMutation, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
  createListing,
  requestLoan,
  transitionLoan,
  event,
} from "./lib/domain";
import { loanAction } from "./lib/validators";
import { today } from "./lib/dates";
import { retryEvent, refreshCalendar } from "./lib/automation";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
function guard() {
  if (process.env.DEMO_SEED_ENABLED !== "true")
    throw new ConvexError("Development verification is disabled.");
}
function prefix(runId: string) {
  if (!/^[a-f0-9-]{36}$/.test(runId))
    throw new ConvexError("Invalid verification identifier.");
  return `Check ${runId}`;
}
export const setup = internalMutation({
  args: {
    runId: v.string(),
    actors: v.optional(
      v.object({
        lender: v.id("users"),
        borrower: v.id("users"),
        other: v.id("users"),
        admin: v.id("users"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    guard();
    prefix(args.runId);
    if (args.actors) return args.actors;
    const ids: Id<"users">[] = [];
    for (const name of ["lender", "borrower", "other", "admin"]) {
      ids.push(
        await ctx.db.insert("users", {
          tokenIdentifier: `verification:${args.runId}:${name}`,
          displayName: name,
          role: name === "admin" ? "admin" : "user",
          trustedLender: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    }
    return { lender: ids[0], borrower: ids[1], other: ids[2], admin: ids[3] };
  },
});
export const tool = internalMutation({
  args: { runId: v.string(), actorId: v.id("users"), name: v.string() },
  handler: async (ctx, args) => {
    guard();
    return createListing(ctx, args.actorId, {
      name: `${prefix(args.runId)} ${args.name}`.slice(0, 100),
      category: "other",
      condition: "good",
      description: "Synthetic data for repeatable integration checks.",
    });
  },
});
export const requestAs = internalMutation({
  args: {
    actorId: v.id("users"),
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, { actorId, ...input }) => {
    guard();
    return requestLoan(ctx, actorId, input);
  },
});
export const approveAs = internalMutation({
  args: { actorId: v.id("users"), loanId: v.id("loans") },
  handler: async (ctx, args) => {
    guard();
    await transitionLoan(ctx, args.actorId, args.loanId, "approve");
    return "approved";
  },
});
export const transitionAs = internalMutation({
  args: { actorId: v.id("users"), loanId: v.id("loans"), action: loanAction },
  handler: async (ctx, args) => {
    guard();
    await transitionLoan(ctx, args.actorId, args.loanId, args.action);
  },
});
export const retryAs = internalMutation({
  args: { actorId: v.id("users"), eventId: v.id("automationEvents") },
  handler: async (ctx, args) => {
    guard();
    const actor = await ctx.db.get(args.actorId);
    if (actor?.role !== "admin")
      throw new ConvexError("Administrator access required.");
    if (await retryEvent(ctx, args.eventId))
      await ctx.scheduler.runAfter(0, internal.automation.dispatch, {
        eventId: args.eventId,
      });
  },
});
export const overdueFixture = internalMutation({
  args: {
    runId: v.string(),
    lender: v.id("users"),
    borrower: v.id("users"),
    count: v.number(),
    kind: v.union(
      v.literal("overdue"),
      v.literal("today"),
      v.literal("future"),
      v.literal("returned"),
    ),
  },
  handler: async (ctx, args) => {
    guard();
    if (!Number.isInteger(args.count) || args.count < 1 || args.count > 100)
      throw new ConvexError("Use bounded fixture batches.");
    const day = today(),
      offset = args.kind === "today" ? 0 : args.kind === "future" ? 2 : -2;
    const endDate = new Date(
      new Date(`${day}T12:00:00Z`).getTime() + offset * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const ids: Id<"loans">[] = [];
    for (let i = 0; i < args.count; i++) {
      const toolId = await createListing(ctx, args.lender, {
        name: `${prefix(args.runId)} ${args.kind} ${i}`.slice(0, 100),
        category: "other",
        condition: "good",
        description: "Synthetic reminder fixture.",
      });
      ids.push(
        await ctx.db.insert("loans", {
          toolId,
          lenderId: args.lender,
          borrowerId: args.borrower,
          toolNameSnapshot: "Reminder check tool",
          startDate: endDate,
          endDate,
          status: args.kind === "returned" ? "returned" : "approved",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    }
    return ids;
  },
});
export const returnAs = internalMutation({
  args: { actorId: v.id("users"), loanId: v.id("loans") },
  handler: async (ctx, args) => {
    guard();
    return transitionLoan(ctx, args.actorId, args.loanId, "return");
  },
});
export const snapshot = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    guard();
    const tools = (await ctx.db.query("tools").collect()).filter((t) =>
        t.name.startsWith(prefix(args.runId)),
      ),
      toolIds = new Set(tools.map((t) => t._id));
    const loans = (await ctx.db.query("loans").collect()).filter((l) =>
        toolIds.has(l.toolId),
      ),
      ids = new Set(loans.map((l) => l._id));
    return {
      tools,
      loans,
      events: (await ctx.db.query("automationEvents").collect()).filter((e) =>
        ids.has(e.loanId),
      ),
      notifications: (await ctx.db.query("notifications").collect()).filter(
        (n) => ids.has(n.loanId),
      ),
      overdueCount: (
        await ctx.db
          .query("loans")
          .withIndex("by_status_endDate", (q) =>
            q.eq("status", "approved").lt("endDate", today()),
          )
          .collect()
      ).length,
      failures: await ctx.db.query("automationFailures").collect(),
      state: await ctx.db
        .query("systemState")
        .withIndex("by_key", (q) => q.eq("key", "calendar"))
        .unique(),
    };
  },
});
export const health = internalMutation({
  args: { reset: v.boolean() },
  handler: async (ctx, args) => {
    guard();
    const day = today();
    const state = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "calendar"))
      .unique();
    if (args.reset && state)
      await ctx.db.patch(state._id, {
        lastOverdueFetchDate: undefined,
        lastHealthCheckDate: undefined,
      });
    if (args.reset)
      for (const source of ["reminder-run-missing", "reminders-incomplete"]) {
        const row = await ctx.db
          .query("automationFailures")
          .withIndex("by_key", (q) => q.eq("key", `${source}:${day}`))
          .unique();
        if (row) await ctx.db.delete(row._id);
      }
    // Locate 11:00 on today's date in the configured timezone without changing the system clock.
    const timezone = process.env.APP_TIMEZONE ?? "UTC";
    let now = Date.now();
    for (let i = 0; i < 3; i++) {
      const p = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(now);
      now +=
        (660 -
          Number(p.find((x) => x.type === "hour")!.value) * 60 -
          Number(p.find((x) => x.type === "minute")!.value)) *
        60000;
    }
    await refreshCalendar(ctx, now);
  },
});
export const markFailed = internalMutation({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, args) => {
    guard();
    await ctx.db.patch(args.eventId, {
      state: "failed",
      attempts: 5,
      lastError: "Synthetic delivery failure for interface verification.",
      updatedAt: Date.now(),
    });
  },
});
export const occurrence = internalMutation({
  args: { eventId: v.id("automationEvents"), occurredAt: v.number() },
  handler: async (ctx, args) => {
    guard();
    await ctx.db.patch(args.eventId, { occurredAt: args.occurredAt });
  },
});
export const manualEvent = internalMutation({
  args: {
    loanId: v.id("loans"),
    type: v.union(v.literal("requested"), v.literal("approved")),
  },
  handler: async (ctx, args) => {
    guard();
    const loan = await ctx.db.get(args.loanId);
    if (!loan) throw new ConvexError("Loan not found.");
    await event(
      ctx,
      { ...loan, status: args.type === "requested" ? "pending" : "approved" },
      args.type,
      args.type === "requested" ? loan.lenderId : loan.borrowerId,
    );
  },
});
async function removeFixtures(ctx: MutationCtx, runId: string) {
  const tools = (await ctx.db.query("tools").collect()).filter((t) =>
      t.name.startsWith(prefix(runId)),
    ),
    toolIds = new Set(tools.map((t) => t._id));
  const loans = (await ctx.db.query("loans").collect()).filter((l) =>
      toolIds.has(l.toolId),
    ),
    ids = new Set(loans.map((l) => l._id));
  for (const row of await ctx.db.query("notifications").collect())
    if (ids.has(row.loanId)) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query("automationEvents").collect())
    if (ids.has(row.loanId)) await ctx.db.delete(row._id);
  for (const row of loans) await ctx.db.delete(row._id);
  for (const row of tools) await ctx.db.delete(row._id);
}
export const clearLoans = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    guard();
    await removeFixtures(ctx, args.runId);
  },
});
export const cleanup = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    guard();
    await removeFixtures(ctx, args.runId);
    for (const user of await ctx.db.query("users").collect())
      if (user.tokenIdentifier.startsWith(`verification:${args.runId}:`))
        await ctx.db.delete(user._id);
  },
});

export const raceEvent = internalMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    guard();
    const loan = await ctx.db.get(args.loanId);
    if (!loan) throw new ConvexError("Loan not found.");
    const now = Date.now();
    return ctx.db.insert("automationEvents", {
      type: "requested",
      loanId: loan._id,
      recipientId: loan.lenderId,
      payload: {
        toolName: loan.toolNameSnapshot,
        status: "pending",
        startDate: loan.startDate,
        endDate: loan.endDate,
      },
      occurredAt: now,
      state: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});
