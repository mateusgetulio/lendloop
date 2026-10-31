/// <reference types="vite/client" />
import { beforeEach, afterEach, it, expect, vi, describe } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { sign, verify, RequestError } from "../convex/lib/signatures";
const modules = import.meta.glob("../convex/**/*.ts");
const page = { paginationOpts: { cursor: null, numItems: 20 } };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T14:00:00Z"));
  vi.stubEnv("APP_TIMEZONE", "UTC");
  vi.stubEnv("DEMO_SEED_ENABLED", "true");
  vi.stubEnv("AUTOMATION_BACKOFF_SECONDS", "2,2,2,2,5");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function fixture() {
  const t = convexTest(schema, modules),
    owner = t.withIdentity({
      subject: "owner",
      issuer: "https://test.clerk.accounts.dev",
    }),
    borrower = t.withIdentity({
      subject: "borrower",
      issuer: "https://test.clerk.accounts.dev",
    });
  const ownerId = await owner.mutation(api.users.ensureCurrent, {}),
    borrowerId = await borrower.mutation(api.users.ensureCurrent, {});
  const toolId = await owner.mutation(api.tools.create, {
    name: "Drill",
    category: "power_tools",
    condition: "good",
    description: "Small drill",
  });
  const loanId = await borrower.mutation(api.loans.request, {
    toolId,
    startDate: "2026-10-31",
    endDate: "2026-11-01",
  });
  const event = (
    await t.run((ctx) => ctx.db.query("automationEvents").collect())
  )[0];
  return { t, owner, borrower, ownerId, borrowerId, loanId, event };
}
describe("Signed envelopes", () => {
  it("verifies Unicode and newlines without reserializing the signed string", async () => {
    const body = { message: "Café\nsecond line" };
    const signed = await sign(body, "notify", "secret");
    expect(
      await verify(
        new Request("http://local", { method: "POST", ...signed }),
        "notify",
        "secret",
      ),
    ).toEqual(body);
  });
  it.each([
    "signature",
    "purpose",
    "secret",
    "timestamp",
    "extra",
    "large",
    "shape",
  ])("rejects %s before processing", async (kind) => {
    const signed = await sign(
      { message: "safe" },
      "notify",
      "secret",
      kind === "timestamp" ? Date.now() - 600000 : Date.now(),
    );
    if (kind === "signature")
      signed.headers["X-LendLoop-Signature"] = "v1=" + "0".repeat(64);
    if (kind === "extra")
      signed.body = JSON.stringify({ ...JSON.parse(signed.body), extra: true });
    if (kind === "large")
      signed.body = JSON.stringify({ payload: " ".repeat(65537) });
    if (kind === "shape") signed.body = "[]";
    await expect(
      verify(
        new Request("http://local", { method: "POST", ...signed }),
        kind === "purpose" ? "failure-report" : "notify",
        kind === "secret" ? "other" : "secret",
      ),
    ).rejects.toBeInstanceOf(RequestError);
  });
});
describe("Durable delivery state", () => {
  it("claims one attempt until due and uses the final delay before failing", async () => {
    const { t, event } = await fixture();
    const first = await t.mutation(internal.automation.beginAttempt, {
      eventId: event._id,
    });
    expect(first?.attempt).toBe(1);
    expect(
      await t.mutation(internal.automation.beginAttempt, {
        eventId: event._id,
      }),
    ).toBeNull();
    for (let i = 1; i < 5; i++) {
      vi.setSystemTime(Date.now() + 2100);
      await t.mutation(internal.automation.beginAttempt, {
        eventId: event._id,
      });
    }
    await t.mutation(internal.automation.sweep, {});
    expect((await t.run((ctx) => ctx.db.get(event._id)))?.state).toBe(
      "pending",
    );
    vi.setSystemTime(Date.now() + 5100);
    await t.mutation(internal.automation.sweep, {});
    expect((await t.run((ctx) => ctx.db.get(event._id)))?.state).toBe("failed");
  });
  it("idempotently delivers a late callback and prevents stale failures or admin replay from reversing it", async () => {
    const { t, event, ownerId } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch(event._id, { state: "failed", attempts: 5 }),
    );
    const args = {
      eventId: event._id,
      message: "Returned safely.",
      n8nExecutionId: "123",
    };
    expect(
      (await t.mutation(internal.automation.notificationResult, args)).result,
    ).toBe("recorded");
    expect(
      (await t.mutation(internal.automation.notificationResult, args)).result,
    ).toBe("duplicate");
    await t.mutation(internal.automation.attemptError, {
      eventId: event._id,
      attempt: 5,
      permanent: true,
      message: "Old error",
    });
    await t.mutation(internal.admin.promote, { userId: ownerId });
    expect((await t.run((ctx) => ctx.db.get(event._id)))?.state).toBe(
      "delivered",
    );
    expect(
      await t.run((ctx) => ctx.db.query("notifications").collect()),
    ).toHaveLength(1);
  });
  it("stores only minimal notification payload fields and resolves recipients from events", async () => {
    const { t, event, ownerId } = await fixture();
    const result = await t.mutation(internal.automation.beginAttempt, {
      eventId: event._id,
    });
    expect(Object.keys(result!.payload).sort()).toEqual([
      "endDate",
      "eventId",
      "loanId",
      "recipientId",
      "startDate",
      "status",
      "toolName",
      "type",
    ]);
    await t.mutation(internal.automation.notificationResult, {
      eventId: event._id,
      message: "Request received.",
      n8nExecutionId: "1",
    });
    expect(
      (await t.run((ctx) => ctx.db.query("notifications").unique()))
        ?.recipientId,
    ).toBe(ownerId);
  });
  it("keeps notification text private to its recipient, even for admins", async () => {
    const { t, event, owner, borrower, borrowerId } = await fixture();
    await t.mutation(internal.automation.notificationResult, {
      eventId: event._id,
      message: "A request.",
      n8nExecutionId: "1",
    });
    expect((await owner.query(api.notifications.list, page)).page).toHaveLength(
      1,
    );
    await t.mutation(internal.admin.promote, { userId: borrowerId });
    expect((await borrower.query(api.notifications.list, page)).page).toEqual(
      [],
    );
    await expect(t.query(api.notifications.list, page)).rejects.toThrow();
  });
  it("requires administrator auth for automation reads and retry", async () => {
    const { t, borrower, event } = await fixture();
    for (const call of [
      () => borrower.query(api.automation.summary, {}),
      () => borrower.query(api.automation.failed, page),
      () => borrower.query(api.automation.failures, page),
      () => borrower.mutation(api.automation.retry, { eventId: event._id }),
      () => t.query(api.automation.summary, {}),
    ])
      await expect(call()).rejects.toThrow();
  });
  it("rejects invalid retry configuration visibly", async () => {
    const { t, event } = await fixture();
    vi.stubEnv("AUTOMATION_BACKOFF_SECONDS", "0,1");
    expect(
      await t.mutation(internal.automation.beginAttempt, {
        eventId: event._id,
      }),
    ).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(event._id)))?.state).toBe("failed");
  });
});
describe("Daily reminder state", () => {
  it("deduplicates callbacks and respects both return commit orders", async () => {
    const { t, owner, loanId } = await fixture();
    await owner.mutation(api.loans.transition, { loanId, action: "approve" });
    vi.setSystemTime(new Date("2026-11-02T14:00:00Z"));
    const args = {
      loanId,
      reminderKey: `overdue:${loanId}:2026-11-02`,
      message: "Please return.",
      n8nExecutionId: "1",
    };
    expect(
      (await t.mutation(internal.automation.reminderResult, args)).result,
    ).toBe("recorded");
    expect(
      (await t.mutation(internal.automation.reminderResult, args)).result,
    ).toBe("duplicate");
    await owner.mutation(api.loans.transition, { loanId, action: "return" });
    expect(
      (await t.mutation(internal.automation.reminderResult, args)).result,
    ).toBe("skipped");
    expect(
      await t.run((ctx) => ctx.db.query("notifications").collect()),
    ).toHaveLength(1);
  });
  it("records a missing run with no overdue loans once per day", async () => {
    const { t } = await fixture();
    await t.mutation(internal.clock.tick, {});
    await t.mutation(internal.clock.tick, {});
    const failures = await t.run((ctx) =>
      ctx.db.query("automationFailures").collect(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].source).toBe("reminder-run-missing");
  });
  it("writes a heartbeat even when a filtered page contains no reminders", async () => {
    const { t } = await fixture();
    const result = await t.mutation(internal.automation.overdue, {
      cursor: null,
      limit: 50,
    });
    expect(result.loans).toEqual([]);
    expect(
      (await t.run((ctx) => ctx.db.query("systemState").unique()))
        ?.lastOverdueFetchDate,
    ).toBe("2026-10-31");
  });
  it("refuses internal verification wrappers without the explicit flag", async () => {
    const { t } = await fixture();
    vi.stubEnv("DEMO_SEED_ENABLED", "false");
    await expect(
      t.query(internal.testing.snapshot, {
        runId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(internal.testing.setup, {
        runId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
  });
});
