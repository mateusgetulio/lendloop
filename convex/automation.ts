import {
  internalAction,
  internalMutation,
  query,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { boundPage, requireActor, requireAdmin } from "./lib/auth";
import {
  backoff,
  failure,
  missingReminders,
  retryEvent,
} from "./lib/automation";
import { today } from "./lib/dates";
import { sign } from "./lib/signatures";
export const beginAttempt = internalMutation({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId),
      now = Date.now();
    if (
      !event ||
      event.state !== "pending" ||
      event.nextAttemptAt > now ||
      event.attempts >= 5
    )
      return null;
    let delays: number[];
    try {
      delays = backoff();
    } catch {
      await ctx.db.patch(eventId, {
        state: "failed",
        lastError: "Invalid retry configuration.",
        updatedAt: now,
      });
      return null;
    }
    await ctx.db.patch(eventId, {
      attempts: event.attempts + 1,
      nextAttemptAt: now + delays[event.attempts] * 1000,
      updatedAt: now,
    });
    return {
      attempt: event.attempts + 1,
      payload: {
        eventId: event._id,
        type: event.type,
        loanId: event.loanId,
        recipientId: event.recipientId,
        ...event.payload,
      },
    };
  },
});
export const attemptError = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    attempt: v.number(),
    permanent: v.boolean(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (event?.state !== "pending" || event.attempts !== args.attempt) return;
    await ctx.db.patch(event._id, {
      ...(args.permanent ? { state: "failed" as const } : {}),
      lastError: args.message.slice(0, 200),
      updatedAt: Date.now(),
    });
  },
});
export const dispatch = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }): Promise<void> => {
    const claimed = await ctx.runMutation(internal.automation.beginAttempt, {
      eventId,
    });
    if (!claimed) return;
    const secret = process.env.CONVEX_TO_N8N_SECRET,
      url = process.env.N8N_NOTIFY_URL;
    if (!secret || !url) {
      await ctx.runMutation(internal.automation.attemptError, {
        eventId,
        attempt: claimed.attempt,
        permanent: true,
        message: "Notification integration is not configured.",
      });
      return;
    }
    try {
      const request = await sign(claimed.payload, "notify", secret);
      const response = await fetch(url, {
        method: "POST",
        ...request,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        await ctx.runMutation(internal.automation.attemptError, {
          eventId,
          attempt: claimed.attempt,
          permanent: response.status === 400 || response.status === 401,
          message: `Notification webhook returned HTTP ${response.status}.`,
        });
    } catch {
      await ctx.runMutation(internal.automation.attemptError, {
        eventId,
        attempt: claimed.attempt,
        permanent: false,
        message: "Notification webhook was unreachable or timed out.",
      });
    }
  },
});
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("automationEvents")
      .withIndex("by_state_nextAttemptAt", (q) =>
        q.eq("state", "pending").lte("nextAttemptAt", Date.now()),
      )
      .take(50);
    for (const event of due) {
      if (event.attempts >= 5)
        await ctx.db.patch(event._id, {
          state: "failed",
          lastError:
            event.lastError ??
            "No delivery callback before the final deadline.",
          updatedAt: Date.now(),
        });
      else
        await ctx.scheduler.runAfter(0, internal.automation.dispatch, {
          eventId: event._id,
        });
    }
    return due.length;
  },
});
export const notificationResult = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    message: v.string(),
    n8nExecutionId: v.string(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("Event not found.");
    const key = `event:${event._id}`;
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!existing)
      await ctx.db.insert("notifications", {
        key,
        loanId: event.loanId,
        recipientId: event.recipientId,
        kind: event.type,
        message: args.message,
        eventId: event._id,
        occurredAt: event.occurredAt,
        n8nExecutionId: args.n8nExecutionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    if (event.state !== "delivered")
      await ctx.db.patch(event._id, {
        state: "delivered",
        lastError: undefined,
        updatedAt: Date.now(),
      });
    return { result: existing ? "duplicate" : "recorded" };
  },
});
export const overdue = internalMutation({
  args: { cursor: v.union(v.null(), v.string()), limit: v.number() },
  handler: async (ctx, args) => {
    boundPage({ numItems: args.limit });
    const businessDate = today();
    const state = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "calendar"))
      .unique();
    if (state)
      await ctx.db.patch(state._id, { lastOverdueFetchDate: businessDate });
    else
      await ctx.db.insert("systemState", {
        key: "calendar",
        today: businessDate,
        lastOverdueFetchDate: businessDate,
      });
    const page = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) =>
        q.eq("status", "approved").lt("endDate", businessDate),
      )
      .paginate({ numItems: args.limit, cursor: args.cursor });
    const loans = [];
    for (const loan of page.page) {
      const reminderKey = `overdue:${loan._id}:${businessDate}`;
      if (
        !(await ctx.db
          .query("notifications")
          .withIndex("by_key", (q) => q.eq("key", reminderKey))
          .unique())
      )
        loans.push({
          reminderKey,
          loanId: loan._id,
          recipientId: loan.borrowerId,
          toolName: loan.toolNameSnapshot,
          endDate: loan.endDate,
        });
    }
    return {
      businessDate,
      cursor: page.continueCursor,
      isDone: page.isDone,
      loans,
    };
  },
});
export const reminderResult = internalMutation({
  args: {
    loanId: v.id("loans"),
    reminderKey: v.string(),
    message: v.string(),
    n8nExecutionId: v.string(),
  },
  handler: async (ctx, args) => {
    const day = today();
    if (args.reminderKey !== `overdue:${args.loanId}:${day}`)
      return { result: "stale" };
    const loan = await ctx.db.get(args.loanId);
    if (!loan || loan.status !== "approved" || loan.endDate >= day)
      return { result: "skipped" };
    if (
      await ctx.db
        .query("notifications")
        .withIndex("by_key", (q) => q.eq("key", args.reminderKey))
        .unique()
    )
      return { result: "duplicate" };
    const now = Date.now();
    await ctx.db.insert("notifications", {
      key: args.reminderKey,
      loanId: loan._id,
      recipientId: loan.borrowerId,
      kind: "overdue",
      message: args.message,
      occurredAt: now,
      n8nExecutionId: args.n8nExecutionId,
      createdAt: now,
      updatedAt: now,
    });
    return { result: "recorded" };
  },
});
export const failureReport = internalMutation({
  args: {
    workflow: v.string(),
    executionId: v.string(),
    node: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => ({
    result: await failure(ctx, {
      key: `${args.executionId}:${args.node}`,
      source: args.workflow,
      reference: args.executionId,
      message: `${args.node}: ${args.message}`.slice(0, 500),
    }),
  }),
});
export const retry = mutation({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, await requireActor(ctx));
    if (await retryEvent(ctx, args.eventId))
      await ctx.scheduler.runAfter(0, internal.automation.dispatch, args);
  },
});
export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, await requireActor(ctx));
    const pending = await ctx.db
      .query("automationEvents")
      .withIndex("by_state_nextAttemptAt", (q) => q.eq("state", "pending"))
      .collect();
    const day = (
      await ctx.db
        .query("systemState")
        .withIndex("by_key", (q) => q.eq("key", "calendar"))
        .unique()
    )?.today;
    const missing = day ? await missingReminders(ctx, day) : [];
    return {
      pendingCount: pending.length,
      oldestPendingAt: pending.length
        ? Math.min(...pending.map((e) => e.createdAt))
        : null,
      missingReminders: missing.slice(0, 50).map((l) => ({
        loanId: l._id,
        toolName: l.toolNameSnapshot,
        endDate: l.endDate,
      })),
      missingCount: missing.length,
    };
  },
});
export const failed = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, await requireActor(ctx));
    boundPage(args.paginationOpts);
    const page = await ctx.db
      .query("automationEvents")
      .withIndex("by_state_nextAttemptAt", (q) => q.eq("state", "failed"))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((e) => ({
        _id: e._id,
        toolName: e.payload.toolName,
        type: e.type,
        attempts: e.attempts,
        lastError: e.lastError ?? "Delivery failed.",
      })),
    };
  },
});
export const failures = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, await requireActor(ctx));
    boundPage(args.paginationOpts);
    return ctx.db
      .query("automationFailures")
      .withIndex("by_createdAt")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
