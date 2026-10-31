import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  object,
  text,
  verify,
  RequestError,
  type Purpose,
} from "./lib/signatures";
import type { Id } from "./_generated/dataModel";
const http = httpRouter();
for (const [path, purpose, keys] of [
  [
    "notifications",
    "notification-result",
    ["eventId", "message", "n8nExecutionId"],
  ],
  ["overdue", "overdue-fetch", ["cursor", "limit"]],
  [
    "reminders",
    "reminder-result",
    ["loanId", "reminderKey", "message", "n8nExecutionId"],
  ],
  [
    "failures",
    "failure-report",
    ["workflow", "executionId", "node", "message"],
  ],
] as [string, Purpose, string[]][]) {
  http.route({
    path: `/automation/${path}`,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      try {
        const secret = process.env.N8N_TO_CONVEX_SECRET;
        if (!secret)
          return Response.json(
            { error: "Integration unavailable" },
            { status: 503 },
          );
        const value = object(await verify(request, purpose, secret), keys);
        if (path === "overdue") {
          if (
            (value.cursor !== null && typeof value.cursor !== "string") ||
            typeof value.limit !== "number" ||
            !Number.isInteger(value.limit) ||
            value.limit < 1 ||
            value.limit > 50 ||
            (typeof value.cursor === "string" && value.cursor.length > 8000)
          )
            throw new RequestError(400);
          return Response.json(
            await ctx.runMutation(internal.automation.overdue, {
              cursor: value.cursor as string | null,
              limit: value.limit,
            }),
          );
        }
        if (path === "notifications") {
          return Response.json(
            await ctx.runMutation(internal.automation.notificationResult, {
              eventId: text(value.eventId, 80) as Id<"automationEvents">,
              message: text(value.message),
              n8nExecutionId: text(value.n8nExecutionId, 80),
            }),
          );
        }
        if (path === "reminders")
          return Response.json(
            await ctx.runMutation(internal.automation.reminderResult, {
              loanId: text(value.loanId, 80) as Id<"loans">,
              reminderKey: text(value.reminderKey, 160),
              message: text(value.message),
              n8nExecutionId: text(value.n8nExecutionId, 80),
            }),
          );
        if (
          ![
            "request-notifications",
            "overdue-reminders",
            "workflow-error",
          ].includes(text(value.workflow, 80)) ||
          !["execution-failed", "item-failed", "page-cap"].includes(
            text(value.node, 80),
          )
        )
          throw new RequestError(400);
        // Store a fixed summary instead of arbitrary execution error text or request data.
        text(value.message);
        return Response.json(
          await ctx.runMutation(internal.automation.failureReport, {
            workflow: value.workflow as string,
            executionId: text(value.executionId, 80),
            node: value.node as string,
            message:
              value.node === "page-cap"
                ? "Reminder scan exceeded its page limit."
                : "Workflow delivery failed. Inspect the private execution record.",
          }),
        );
      } catch (error) {
        if (error instanceof RequestError)
          return Response.json(
            { error: "Request rejected" },
            { status: error.status },
          );
        return Response.json({ error: "Operation failed" }, { status: 400 });
      }
    }),
  });
}
export default http;
