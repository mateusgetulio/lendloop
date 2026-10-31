import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { today, validateRange } from "./dates";
import { overlaps } from "../../lib/catalog";
import { requireAdmin } from "./auth";
export type ListingInput = Pick<
  Doc<"tools">,
  "name" | "description" | "category" | "condition"
>;
export function cleanListing(input: ListingInput) {
  const name = input.name.trim(),
    description = input.description.trim();
  if (name.length < 1 || name.length > 100)
    throw new ConvexError("Name must be between 1 and 100 characters.");
  if (description.length < 1 || description.length > 500)
    throw new ConvexError("Description must be between 1 and 500 characters.");
  return { ...input, name, description };
}
export async function approvedLoans(ctx: QueryCtx, toolId: Id<"tools">) {
  return ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", toolId).eq("status", "approved"),
    )
    .collect();
}
export async function event(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  type: Doc<"automationEvents">["type"],
  recipientId: Id<"users">,
) {
  const now = Date.now();
  await ctx.db.insert("automationEvents", {
    type,
    loanId: loan._id,
    recipientId,
    payload: {
      toolName: loan.toolNameSnapshot,
      status: loan.status,
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
}
export async function createListing(
  ctx: MutationCtx,
  actorId: Id<"users">,
  input: ListingInput,
) {
  const now = Date.now();
  return ctx.db.insert("tools", {
    ...cleanListing(input),
    ownerId: actorId,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}
export async function editListing(
  ctx: MutationCtx,
  actorId: Id<"users">,
  toolId: Id<"tools">,
  input: ListingInput,
) {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.ownerId !== actorId || tool.deletedAt !== null)
    throw new ConvexError("You can edit only your active listings.");
  await ctx.db.patch(toolId, { ...cleanListing(input), updatedAt: Date.now() });
}
export async function removeListing(
  ctx: MutationCtx,
  actorId: Id<"users">,
  toolId: Id<"tools">,
) {
  const tool = await ctx.db.get(toolId),
    actor = await ctx.db.get(actorId);
  if (!tool || !actor || (tool.ownerId !== actorId && actor.role !== "admin"))
    throw new ConvexError("You cannot remove this listing.");
  if (tool.deletedAt !== null) return;
  const day = today(),
    approved = await approvedLoans(ctx, toolId);
  if (actor.role !== "admin" && approved.some((l) => l.startDate <= day))
    throw new ConvexError(
      "Confirm the outstanding loan as returned before deleting this listing.",
    );
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", toolId).eq("status", "pending"),
    )
    .collect();
  const now = Date.now();
  await ctx.db.patch(toolId, { deletedAt: now, updatedAt: now });
  for (const loan of [
    ...pending,
    ...approved.filter((l) => l.startDate > day),
  ]) {
    const status = loan.status === "pending" ? "declined" : "cancelled";
    await ctx.db.patch(loan._id, { status, updatedAt: now });
    await event(ctx, { ...loan, status }, status, loan.borrowerId);
  }
}
export async function requestLoan(
  ctx: MutationCtx,
  actorId: Id<"users">,
  input: { toolId: Id<"tools">; startDate: string; endDate: string },
) {
  const day = today();
  validateRange(input.startDate, input.endDate, day);
  const tool = await ctx.db.get(input.toolId);
  if (!tool || tool.deletedAt !== null)
    throw new ConvexError("This tool is no longer listed.");
  if (tool.ownerId === actorId)
    throw new ConvexError("You cannot borrow your own tool.");
  const approved = await approvedLoans(ctx, tool._id);
  if (approved.some((l) => l.endDate < day))
    throw new ConvexError(
      "This tool has an overdue loan. Try again after it is returned.",
    );
  if (approved.some((l) => overlaps(l, input)))
    throw new ConvexError("These dates overlap an approved loan.");
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", tool._id).eq("status", "pending"),
    )
    .collect();
  if (
    [...pending, ...approved].some(
      (l) => l.borrowerId === actorId && overlaps(l, input),
    )
  )
    throw new ConvexError(
      "You already have a request for overlapping dates on this tool.",
    );
  const now = Date.now();
  const id = await ctx.db.insert("loans", {
    ...input,
    lenderId: tool.ownerId,
    borrowerId: actorId,
    toolNameSnapshot: tool.name,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  await event(ctx, (await ctx.db.get(id))!, "requested", tool.ownerId);
  return id;
}
export type LoanAction = "approve" | "decline" | "cancel" | "return";
export async function transitionLoan(
  ctx: MutationCtx,
  actorId: Id<"users">,
  loanId: Id<"loans">,
  action: LoanAction,
) {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new ConvexError("Request not found.");
  const owner = loan.lenderId === actorId,
    borrower = loan.borrowerId === actorId;
  if (action === "cancel" ? !(owner || borrower) : !owner)
    throw new ConvexError("You cannot perform this action on this request.");
  const next = (
    {
      approve: "approved",
      decline: "declined",
      cancel: "cancelled",
      return: "returned",
    } as const
  )[action];
  if (loan.status === next) return;
  const day = today();
  if (action === "cancel") {
    if (
      !(loan.status === "pending" && borrower) &&
      !(loan.status === "approved" && day < loan.startDate)
    )
      throw new ConvexError(
        "Only the borrower can cancel a pending request. Approved loans can be cancelled only before they start.",
      );
  } else if (action === "return") {
    if (loan.status !== "approved" || day < loan.startDate)
      throw new ConvexError("Only a started approved loan can be returned.");
  } else {
    if (loan.status !== "pending")
      throw new ConvexError(
        "Only pending requests can be approved or declined.",
      );
    if (action === "approve") {
      const tool = await ctx.db.get(loan.toolId);
      if (!tool || tool.deletedAt !== null)
        throw new ConvexError("This tool is no longer listed.");
      if (loan.startDate < day)
        throw new ConvexError("This request has expired. Decline it instead.");
      const approved = await approvedLoans(ctx, loan.toolId);
      if (approved.some((l) => l.endDate < day || overlaps(l, loan)))
        throw new ConvexError(
          "This tool has a conflicting approved or overdue loan.",
        );
    }
  }
  const now = Date.now();
  await ctx.db.patch(loanId, {
    status: next,
    updatedAt: now,
    ...(next === "returned" ? { returnedAt: now } : {}),
  });
  const recipient =
    next === "cancelled" && borrower ? loan.lenderId : loan.borrowerId;
  await event(ctx, { ...loan, status: next }, next, recipient);
}
export async function setTrusted(
  ctx: MutationCtx,
  actorId: Id<"users">,
  userId: Id<"users">,
  trusted: boolean,
) {
  await requireAdmin(ctx, actorId);
  if (!(await ctx.db.get(userId))) throw new ConvexError("User not found.");
  await ctx.db.patch(userId, { trustedLender: trusted, updatedAt: Date.now() });
}
