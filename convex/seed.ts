import { internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { today } from "./lib/dates";
import { event } from "./lib/domain";
import type { Id } from "./_generated/dataModel";

export const demo = internalMutation({
  args: { lenderId: v.id("users"), borrowerId: v.id("users") },
  handler: async (ctx, { lenderId, borrowerId }) => {
    if (process.env.DEMO_SEED_ENABLED !== "true")
      throw new ConvexError("Demo data creation is disabled.");
    const lender = await ctx.db.get(lenderId),
      borrower = await ctx.db.get(borrowerId);
    if (
      !lender ||
      !borrower ||
      lenderId === borrowerId ||
      !lender.tokenIdentifier.startsWith("https://") ||
      !borrower.tokenIdentifier.startsWith("https://")
    )
      throw new ConvexError(
        "Choose two distinct existing accounts created through sign-in.",
      );
    const day = today(),
      now = Date.now();
    const date = (offset: number) =>
      new Date(new Date(`${day}T12:00:00Z`).getTime() + offset * 86400000)
        .toISOString()
        .slice(0, 10);
    const entries = [
      {
        key: "overdue",
        name: "Community drill",
        category: "power_tools" as const,
        start: -5,
        end: -2,
        status: "approved" as const,
      },
      {
        key: "today",
        name: "Garden spade",
        category: "garden" as const,
        start: 0,
        end: 0,
        status: "approved" as const,
      },
      {
        key: "future",
        name: "Camping tent",
        category: "camping" as const,
        start: 3,
        end: 5,
        status: "approved" as const,
      },
      {
        key: "returned",
        name: "Kitchen mixer",
        category: "kitchen" as const,
        start: -4,
        end: -1,
        status: "returned" as const,
      },
      {
        key: "available",
        name: "Step ladder",
        category: "other" as const,
        start: 0,
        end: 0,
        status: null,
      },
    ];
    const owned = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", lenderId))
      .collect();
    const result: {
      scenario: string;
      toolId: Id<"tools">;
      loanId: Id<"loans"> | null;
      created: boolean;
    }[] = [];
    for (const entry of entries) {
      const marker = `LendLoop demo: ${entry.key}.`;
      const existing = owned.find((tool) =>
        tool.description.startsWith(marker),
      );
      if (existing) {
        const loan = await ctx.db
          .query("loans")
          .withIndex("by_tool_status", (q) => q.eq("toolId", existing._id))
          .first();
        if (loan && loan.borrowerId !== borrowerId)
          throw new ConvexError(
            "This lender already has a demo set for another borrower. Reuse the original pair.",
          );
        result.push({
          scenario: entry.key,
          toolId: existing._id,
          loanId: loan?._id ?? null,
          created: false,
        });
        continue;
      }
      const toolId = await ctx.db.insert("tools", {
        ownerId: lenderId,
        name: entry.name,
        category: entry.category,
        condition: "good",
        description: `${marker} A shared neighborhood tool for trying the lending flow.`,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      let loanId: Id<"loans"> | null = null;
      if (entry.status) {
        loanId = await ctx.db.insert("loans", {
          toolId,
          lenderId,
          borrowerId,
          toolNameSnapshot: entry.name,
          startDate: date(entry.start),
          endDate: date(entry.end),
          status: entry.status,
          ...(entry.status === "returned" ? { returnedAt: now } : {}),
          createdAt: now,
          updatedAt: now,
        });
        await event(
          ctx,
          (await ctx.db.get(loanId))!,
          entry.status === "returned" ? "returned" : "approved",
          borrowerId,
        );
      }
      result.push({ scenario: entry.key, toolId, loanId, created: true });
    }
    return { businessDate: day, entries: result };
  },
});
