import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { sign, type Purpose } from "../convex/lib/signatures.ts";
import { openBrowserChecks, type BrowserChecks } from "./browser.ts";
const exec = promisify(execFile);
assert.equal(process.version, "v22.22.0", "Use the pinned Node version.");
process.loadEnvFile(".env");
process.loadEnvFile(".env.local");
assert(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.NEXT_PUBLIC_CONVEX_URL!).hostname,
  ),
  "Use a dedicated local deployment.",
);
const runId = randomUUID(),
  results: { check: string; result: string }[] = [];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function command(file: string, args: string[], allowFailure = false) {
  try {
    return (
      await exec(file, args, { maxBuffer: 32 * 1024 * 1024, env: process.env })
    ).stdout;
  } catch {
    if (allowFailure) return null;
    throw new Error(`${file} command failed; inspect the running service.`);
  }
}
async function cli<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const value = await command("npx", [
    "convex",
    "run",
    name,
    JSON.stringify(args),
  ]);
  return (value?.trim() ? JSON.parse(value) : undefined) as T;
}
async function envSet(name: string, value: string | undefined) {
  await command(
    "npx",
    [
      "convex",
      "env",
      ...(value === undefined ? ["remove", name] : ["set", name, value]),
    ],
    value === undefined,
  );
}
async function envGet(name: string) {
  const result = await command("npx", ["convex", "env", "get", name], true);
  return result?.trim() || undefined;
}
async function docker(args: string[]) {
  return command("docker", ["compose", ...args]);
}
async function waitFor<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  timeout = 45000,
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await read();
    if (ok(value)) return value;
    await pause(400);
  }
  throw new Error("Timed out waiting for the expected durable state.");
}
async function healthy() {
  await waitFor(async () => {
    try {
      return (await fetch("http://localhost:5678/healthz")).ok;
    } catch {
      return false;
    }
  }, Boolean);
}
async function check(name: string, run: () => Promise<void>) {
  process.stdout.write(`RUN ${name}\n`);
  await run();
  results.push({ check: name, result: "pass" });
  console.log(`PASS ${name}`);
}
type Event = {
  _id: string;
  loanId: string;
  recipientId: string;
  type: string;
  state: string;
  attempts: number;
  payload: {
    toolName: string;
    status: string;
    startDate: string;
    endDate: string;
  };
  occurredAt: number;
  nextAttemptAt: number;
};
type Note = {
  _id: string;
  key: string;
  loanId: string;
  recipientId: string;
  kind: string;
  message: string;
  occurredAt: number;
};
type Snapshot = {
  tools: { _id: string; name: string }[];
  overdueCount: number;
  loans: { _id: string; status: string; startDate: string; endDate: string }[];
  events: Event[];
  notifications: Note[];
  failures: {
    key: string;
    source: string;
    reference: string;
    message: string;
    createdAt: number;
  }[];
  state: {
    today: string;
    lastOverdueFetchDate?: string;
    lastHealthCheckDate?: string;
  };
};
let actors: { lender: string; borrower: string; other: string; admin: string },
  browser: BrowserChecks | undefined;
const snapshot = () => cli<Snapshot>("testing:snapshot", { runId });
const snapshotEvent = (id: string) =>
  snapshot().then((s) => s.events.find((e) => e._id === id));
const tool = (name: string) =>
  cli<string>("testing:tool", { runId, actorId: actors.lender, name });
let day = "";
const offset = (n: number) =>
  new Date(new Date(day + "T12:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
const request = (
  toolId: string,
  startDate = day,
  endDate = offset(1),
  actorId = actors.borrower,
) => cli<string>("testing:requestAs", { actorId, toolId, startDate, endDate });
const transition = (loanId: string, action: string, actorId = actors.lender) =>
  cli("testing:transitionAs", { actorId, loanId, action });
const eventsFor = (loanId: string) =>
  snapshot().then((s) => s.events.filter((e) => e.loanId === loanId));
const payload = (event: Event) => ({
  eventId: event._id,
  type: event.type,
  loanId: event.loanId,
  recipientId: event.recipientId,
  ...event.payload,
});
const n8nSecret = process.env.CONVEX_TO_N8N_SECRET!,
  reverseSecret = process.env.N8N_TO_CONVEX_SECRET!,
  httpBase = "http://127.0.0.1:3211/automation/";
async function signedPost(path: string, purpose: Purpose, value: unknown) {
  return fetch(httpBase + path, {
    method: "POST",
    ...(await sign(value, purpose, reverseSecret)),
  });
}
async function reminder(loanId: string, key = `overdue:${loanId}:${day}`) {
  const response = await signedPost("reminders", "reminder-result", {
    loanId,
    reminderKey: key,
    message: "Please return your overdue tool.",
    n8nExecutionId: "verification",
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<{ result: string }>;
}
let broker = 5681;
async function runReminders(proxy?: string) {
  const port = broker++;
  await docker([
    "exec",
    "-T",
    "-e",
    `N8N_RUNNERS_BROKER_PORT=${port}`,
    ...(proxy ? ["-e", `LENDLOOP_CONVEX_HTTP_URL=${proxy}`] : []),
    "n8n",
    "n8n",
    "execute",
    "--id=LendLoopOverdue",
  ]);
}
async function fixture(
  kind: "overdue" | "today" | "future" | "returned",
  count = 1,
) {
  return cli<string[]>("testing:overdueFixture", {
    runId,
    lender: actors.lender,
    borrower: actors.borrower,
    count,
    kind,
  });
}
async function drainEvents() {
  await waitFor(
    async () => {
      await cli("automation:sweep");
      return snapshot();
    },
    (s) => s.events.every((e) => e.state === "delivered"),
    90000,
  );
}
async function reminderProxy(failLoan: string) {
  let failures = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    let value: Record<string, unknown> = {};
    try {
      value = JSON.parse(JSON.parse(body.toString()).payload);
    } catch {}
    if (req.url === "/automation/reminders" && value.loanId === failLoan) {
      failures++;
      res.writeHead(503, { "content-type": "application/json" });
      res.end('{"error":"Temporary verification failure"}');
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:3211" + req.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-LendLoop-Timestamp": String(
            req.headers["x-lendloop-timestamp"] ?? "",
          ),
          "X-LendLoop-Signature": String(
            req.headers["x-lendloop-signature"] ?? "",
          ),
        },
        body,
      });
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(await response.text());
    } catch {
      res.writeHead(503);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    url: `http://host.docker.internal:${address.port}`,
    count: () => failures,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
const saved = {
  backoff: await envGet("AUTOMATION_BACKOFF_SECONDS"),
  enabled: await envGet("DEMO_SEED_ENABLED"),
};
try {
  assert.equal((await command("npm", ["--version"]))?.trim(), "10.9.4");
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/verification.json",
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        status: "running",
        results,
        browser: false,
      },
      null,
      2,
    ),
  );
  await healthy();
  await envSet("DEMO_SEED_ENABLED", "false");
  await assert.rejects(() => cli("testing:setup", { runId }));
  await envSet("DEMO_SEED_ENABLED", "true");
  await envSet("AUTOMATION_BACKOFF_SECONDS", "2,2,2,2,2");
  if (!process.argv.includes("--skip-browser"))
    browser = await openBrowserChecks(cli);
  actors = await cli("testing:setup", {
    runId,
    ...(browser ? { actors: browser.actors } : {}),
  });
  await cli("clock:tick");
  day = (await cli<{ today: string }>("clock:settings")).today;
  await check(
    "Parallel approvals use separate backend CLI processes",
    async () => {
      const id = await tool("parallel approval"),
        first = await request(id),
        second = await request(id, day, offset(1), actors.other);
      const outcomes = await Promise.allSettled([
        cli("testing:approveAs", { actorId: actors.lender, loanId: first }),
        cli("testing:approveAs", { actorId: actors.lender, loanId: second }),
      ]);
      assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      const state = await snapshot();
      assert.equal(
        state.loans.filter(
          (l) => [first, second].includes(l._id) && l.status === "approved",
        ).length,
        1,
      );
      await cli("testing:clearLoans", { runId });
    },
  );
  await check(
    "Each transition delivers once to the intended recipient through the workflow",
    async () => {
      const id = await tool("status messages");
      const loan = await request(id);
      await transition(loan, "approve");
      await transition(loan, "return");
      const decline = await request(id);
      await transition(decline, "decline");
      const cancelled = await request(id, offset(2), offset(3));
      await transition(cancelled, "cancel", actors.borrower);
      await drainEvents();
      const state = await snapshot();
      for (const event of state.events) {
        const notes = state.notifications.filter(
          (n) => n.key === `event:${event._id}`,
        );
        assert.equal(notes.length, 1);
        assert.equal(notes[0].recipientId, event.recipientId);
        assert.equal(notes[0].kind, event.type);
      }
      assert(state.events.some((e) => e.type === "requested"));
      assert(state.events.some((e) => e.type === "returned"));
      assert(state.events.some((e) => e.type === "declined"));
      assert(state.events.some((e) => e.type === "cancelled"));
      if (browser) await browser.notifications();
    },
  );
  await check(
    "Both receivers reject nine invalid signing and envelope cases without writing notifications",
    async () => {
      const event = (await snapshot()).events[0],
        value = payload(event);
      value.toolName = "Neighborhood café\nsecond line";
      const before = (await snapshot()).notifications.length;
      for (const [url, purpose, secret, other] of [
        [
          "http://localhost:5678/webhook/lendloop-notify",
          "notify",
          n8nSecret,
          reverseSecret,
        ],
        [
          httpBase + "notifications",
          "notification-result",
          reverseSecret,
          n8nSecret,
        ],
      ] as const) {
        const body =
          purpose === "notify"
            ? value
            : {
                eventId: event._id,
                message: "Neighborhood café\nsecond line",
                n8nExecutionId: "verification",
              };
        for (const kind of [
          "zero",
          "malformed",
          "changed",
          "purpose",
          "direction",
          "stale",
          "future",
          "extra",
          "oversized",
        ]) {
          const signed = await sign(
            body,
            kind === "purpose" ? "failure-report" : purpose,
            kind === "direction" ? other : secret,
            Date.now() +
              (kind === "stale" ? -600000 : kind === "future" ? 600000 : 0),
          );
          if (kind === "zero")
            signed.headers["X-LendLoop-Signature"] = "v1=" + "0".repeat(64);
          if (kind === "malformed")
            signed.headers["X-LendLoop-Signature"] = "v1=not-hex";
          if (kind === "changed")
            signed.body = signed.body.replace("café", "cafe");
          if (kind === "extra")
            signed.body = JSON.stringify({
              ...JSON.parse(signed.body),
              unexpected: true,
            });
          if (kind === "oversized")
            signed.body = JSON.stringify({ payload: "x".repeat(70000) });
          const response = await fetch(url, { method: "POST", ...signed });
          assert.equal(
            response.status,
            kind === "extra" ? 400 : kind === "oversized" ? 413 : 401,
            kind,
          );
        }
        const valid = await fetch(url, {
          method: "POST",
          ...(await sign(body, purpose, secret)),
        });
        assert.equal(valid.status, 200);
      }
      await pause(500);
      assert.equal((await snapshot()).notifications.length, before);
      const substituted = await signedPost(
        "notifications",
        "notification-result",
        {
          eventId: event._id,
          message: "safe",
          n8nExecutionId: "verification",
          recipientId: actors.other,
        },
      );
      assert.equal(substituted.status, 400);
    },
  );
  await check(
    "Delivery retries survive an unavailable workflow service and admin replay",
    async () => {
      await docker(["stop", "n8n"]);
      const id = await tool("offline delivery"),
        loan = await request(id);
      const event = (await eventsFor(loan))[0];
      assert((await snapshot()).loans.some((l) => l._id === loan));
      await waitFor(
        async () => {
          await cli("automation:sweep");
          return snapshotEvent(event._id);
        },
        (e) => e?.state === "failed",
        60000,
      );
      assert.equal((await snapshotEvent(event._id))?.attempts, 5);
      await docker(["start", "n8n"]);
      await healthy();
      if (browser) await browser.retry(event.payload.toolName);
      else
        await cli("testing:retryAs", {
          actorId: actors.admin,
          eventId: event._id,
        });
      await waitFor(
        () => snapshotEvent(event._id),
        (e) => e?.state === "delivered",
      );
      assert.equal(
        (await snapshot()).notifications.filter(
          (n) => n.key === `event:${event._id}`,
        ).length,
        1,
      );
    },
  );
  await check(
    "Accepted webhooks with failed callbacks stay pending and later settle once",
    async () => {
      await envSet("N8N_TO_CONVEX_SECRET", reverseSecret + "-temporary");
      try {
        const id = await tool("callback recovery"),
          loan = await request(id),
          event = (await eventsFor(loan))[0];
        await waitFor(
          () => snapshotEvent(event._id),
          (e) => Boolean(e?.attempts),
        );
        const accepted = await fetch(
          "http://localhost:5678/webhook/lendloop-notify",
          {
            method: "POST",
            ...(await sign(payload(event), "notify", n8nSecret)),
          },
        );
        assert.equal(accepted.status, 200);
        await pause(3500);
        assert.equal((await snapshotEvent(event._id))?.state, "pending");
        await envSet("N8N_TO_CONVEX_SECRET", reverseSecret);
        await cli("automation:sweep");
        await waitFor(
          () => snapshotEvent(event._id),
          (e) => e?.state === "delivered",
        );
        assert.equal(
          (await snapshot()).notifications.filter(
            (n) => n.key === `event:${event._id}`,
          ).length,
          1,
        );
      } finally {
        await envSet("N8N_TO_CONVEX_SECRET", reverseSecret);
      }
    },
  );
  await check(
    "Final deadline and late callbacks cannot overwrite delivered state",
    async () => {
      await envSet("AUTOMATION_BACKOFF_SECONDS", "2,2,2,2,10");
      await docker(["stop", "n8n"]);
      const id = await tool("late callback"),
        loan = await request(id),
        event = (await eventsFor(loan))[0];
      await waitFor(
        async () => {
          await cli("automation:sweep");
          return snapshotEvent(event._id);
        },
        (e) => e?.attempts === 5,
        60000,
      );
      const fifth = await snapshotEvent(event._id);
      assert(fifth);
      assert(
        Date.now() < fifth.nextAttemptAt,
        "Observe the final callback deadline before it expires.",
      );
      assert.equal(fifth.state, "pending");
      await cli("automation:sweep");
      assert.equal((await snapshotEvent(event._id))?.state, "pending");
      await waitFor(
        async () => {
          await cli("automation:sweep");
          return snapshotEvent(event._id);
        },
        (e) => e?.state === "failed",
      );
      for (let i = 0; i < 2; i++) {
        const result = await signedPost(
          "notifications",
          "notification-result",
          {
            eventId: event._id,
            message: "Late workflow result.",
            n8nExecutionId: "verification-late",
          },
        );
        assert.equal(result.status, 200);
      }
      await cli("automation:attemptError", {
        eventId: event._id,
        attempt: 5,
        permanent: true,
        message: "Old failure",
      });
      assert.equal((await snapshotEvent(event._id))?.state, "delivered");
      await docker(["start", "n8n"]);
      await healthy();
    },
  );
  await check(
    "Dispatch claims serialize and history follows occurrence rather than arrival",
    async () => {
      await docker(["stop", "n8n"]);
      await envSet("AUTOMATION_BACKOFF_SECONDS", "30,30,30,30,30");
      const id = await tool("claim ordering"),
        loan = await request(id),
        original = (await eventsFor(loan))[0],
        raceId = await cli<string>("testing:raceEvent", { loanId: loan });
      await Promise.all([
        cli("automation:dispatch", { eventId: raceId }),
        cli("automation:sweep"),
      ]);
      assert.equal((await snapshotEvent(raceId))!.attempts, 1);
      const event = original;
      await transition(loan, "approve");
      const all = await eventsFor(loan),
        approved = all.find((e) => e.type === "approved")!;
      await cli("testing:occurrence", { eventId: event._id, occurredAt: 1000 });
      await cli("testing:occurrence", {
        eventId: approved._id,
        occurredAt: 2000,
      });
      for (const e of [approved, event])
        assert.equal(
          (
            await signedPost("notifications", "notification-result", {
              eventId: e._id,
              message: `Status ${e.type}`,
              n8nExecutionId: "verification-order",
            })
          ).status,
          200,
        );
      const state = await snapshot();
      assert(
        state.notifications.find((n) => n.key === `event:${event._id}`)!
          .occurredAt <
          state.notifications.find((n) => n.key === `event:${approved._id}`)!
            .occurredAt,
      );
      assert.equal(state.loans.find((l) => l._id === loan)?.status, "approved");
      if (browser) {
        const notes = await browser.ordering();
        for (let i = 1; i < notes.page.length; i++)
          assert(notes.page[i - 1].occurredAt >= notes.page[i].occurredAt);
      }
      await docker(["start", "n8n"]);
      await healthy();
      await cli("testing:clearLoans", { runId });
      await envSet("AUTOMATION_BACKOFF_SECONDS", "2,2,2,2,2");
    },
  );
  await check(
    "Daily reminders select only overdue outstanding loans and parallel runs deduplicate",
    async () => {
      const overdue = await fixture("overdue", 3);
      await fixture("today");
      await fixture("future");
      await fixture("returned");
      const response = await signedPost("overdue", "overdue-fetch", {
        cursor: null,
        limit: 50,
      });
      assert.equal(response.status, 200);
      const page = await response.json();
      assert(page.loans.length >= 3);
      for (const loan of page.loans)
        assert.deepEqual(Object.keys(loan).sort(), [
          "endDate",
          "loanId",
          "recipientId",
          "reminderKey",
          "toolName",
        ]);
      await Promise.all([runReminders(), runReminders()]);
      const state = await snapshot();
      assert.equal(
        state.notifications.filter((n) => n.kind === "overdue").length,
        3,
      );
      for (const id of overdue)
        assert.equal(
          state.notifications.filter((n) => n.key === `overdue:${id}:${day}`)
            .length,
          1,
        );
    },
  );
  await check(
    "Return and reminder are coherent in both commit orders",
    async () => {
      const [first, second] = await fixture("overdue", 2);
      await cli("testing:returnAs", { actorId: actors.lender, loanId: first });
      assert.equal((await reminder(first)).result, "skipped");
      assert.equal((await reminder(second)).result, "recorded");
      await cli("testing:returnAs", { actorId: actors.lender, loanId: second });
      assert.equal(
        (await snapshot()).notifications.filter(
          (n) => n.loanId === second && n.kind === "overdue",
        ).length,
        1,
      );
      assert.equal(
        (await reminder(second, `overdue:${second}:${offset(-1)}`)).result,
        "stale",
      );
    },
  );
  await check(
    "Partial reminder failures are reported and same-day recovery fills only missing rows",
    async () => {
      const ids = await fixture("overdue", 3),
        proxy = await reminderProxy(ids[0]);
      try {
        await runReminders(proxy.url);
        assert.equal(proxy.count(), 3);
        const state = await snapshot();
        assert.equal(
          state.notifications.filter(
            (n) => ids.includes(n.loanId) && n.kind === "overdue",
          ).length,
          2,
        );
        assert(
          state.failures.some(
            (f) =>
              f.source === "overdue-reminders" && f.key.includes("item-failed"),
          ),
        );
      } finally {
        await proxy.close();
      }
      await runReminders();
      const after = await snapshot();
      for (const id of ids)
        assert.equal(
          after.notifications.filter(
            (n) => n.loanId === id && n.kind === "overdue",
          ).length,
          1,
        );
    },
  );
  await check(
    "Empty filtered pages do not stop scans and the page cap reports unfinished work",
    async () => {
      await cli("testing:clearLoans", { runId });
      const first = await fixture("overdue", 50),
        later = await fixture("overdue");
      for (const id of first) await reminder(id);
      await runReminders();
      assert.equal(
        (await snapshot()).notifications.filter((n) => n.kind === "overdue")
          .length,
        51,
      );
      assert(
        (await snapshot()).notifications.some((n) => n.loanId === later[0]),
      );
      await cli("testing:clearLoans", { runId });
      for (let i = 0; i < 10; i++) await fixture("overdue", 100);
      await fixture("overdue", 1);
      await runReminders();
      const capped = await snapshot();
      assert.equal(
        capped.notifications.filter((n) => n.kind === "overdue").length,
        1000,
      );
      assert(
        capped.failures.some(
          (f) =>
            f.source === "overdue-reminders" && f.key.endsWith(":page-cap"),
        ),
      );
      await runReminders();
      assert.equal(
        (await snapshot()).notifications.filter((n) => n.kind === "overdue")
          .length,
        1000,
      );
      await cli("testing:clearLoans", { runId });
    },
  );
  await check(
    "A missing scheduled fetch is visible even with zero overdue loans",
    async () => {
      await docker([
        "exec",
        "-T",
        "n8n",
        "n8n",
        "unpublish:workflow",
        "--id=LendLoopOverdue",
      ]);
      await docker(["restart", "n8n"]);
      await healthy();
      await cli("testing:health", { reset: true });
      let state = await snapshot();
      assert.equal(state.loans.length, 0);
      assert.equal(state.overdueCount, 0);
      if (browser)
        await browser.failureVisible(
          "The scheduled reminder fetch has not run today.",
        );
      assert(
        state.failures.some((f) => f.key === `reminder-run-missing:${day}`),
      );
      await docker([
        "exec",
        "-T",
        "n8n",
        "n8n",
        "publish:workflow",
        "--id=LendLoopOverdue",
      ]);
      await docker(["restart", "n8n"]);
      await healthy();
      await runReminders();
      await cli("testing:health", { reset: false });
      state = await snapshot();
      assert.equal(state.state.lastOverdueFetchDate, day);
    },
  );
  await check(
    "A failed published execution invokes the error workflow and records a visible failure",
    async () => {
      const [loan] = await fixture("today");
      await cli("testing:manualEvent", { loanId: loan, type: "requested" });
      await drainEvents();
      const e = (await eventsFor(loan))[0];
      const invalid = { ...payload(e), eventId: loan };
      const before = (await snapshot()).failures.length;
      const response = await fetch(
        "http://localhost:5678/webhook/lendloop-notify",
        { method: "POST", ...(await sign(invalid, "notify", n8nSecret)) },
      );
      assert.equal(response.status, 200);
      await waitFor(
        snapshot,
        (s) =>
          s.failures.length > before &&
          s.failures.some(
            (f) =>
              f.source === "request-notifications" &&
              f.key.endsWith(":execution-failed"),
          ),
      );
      if (browser) await browser.adminVisible();
    },
  );
  await check(
    "Workflow exports and repository files contain no secrets or unnecessary payload fields",
    async () => {
      const names = (await command("git", [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ]))!
        .split("\0")
        .filter(Boolean);
      for (const file of names) {
        let bytes: string;
        try {
          bytes = await readFile(file, "utf8");
        } catch {
          continue;
        }
        for (const secret of [
          process.env.CLERK_SECRET_KEY,
          n8nSecret,
          reverseSecret,
          process.env.N8N_ENCRYPTION_KEY,
        ].filter((v): v is string => Boolean(v)))
          assert(
            !bytes.includes(secret),
            "A private value was found in a proposed file.",
          );
      }
      for (const file of await readdir("n8n/workflows")) {
        const raw = await readFile("n8n/workflows/" + file, "utf8"),
          workflow = JSON.parse(raw);
        assert(!("pinData" in workflow));
        assert(!raw.includes("tokenIdentifier"));
        assert(!raw.includes("email"));
        assert(!raw.includes("displayName"));
        assert(!raw.includes("description"));
      }
      const id = await tool("minimal dispatch payload");
      const loan = await request(id);
      await drainEvents();
      const eventId = await cli<string>("testing:raceEvent", { loanId: loan });
      const claim = await cli<{ payload: Record<string, unknown> }>(
        "automation:beginAttempt",
        { eventId },
      );
      assert.deepEqual(Object.keys(claim.payload).sort(), [
        "endDate",
        "eventId",
        "loanId",
        "recipientId",
        "startDate",
        "status",
        "toolName",
        "type",
      ]);
      const trace = await docker([
        "exec",
        "-T",
        "n8n",
        "node",
        "-e",
        String.raw`
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});
const row=db.prepare('select d.data from execution_entity e join execution_data d on d.executionId=e.id where e.workflowId=? order by e.id desc limit 1').get('LendLoopNotify');
const refs=JSON.parse(row.data),seen=new WeakMap();
function hydrate(value){const actual=typeof value==='string'?refs[Number(value)]:value;if(!actual||typeof actual!=='object')return actual;if(seen.has(actual))return seen.get(actual);const out=Array.isArray(actual)?[]:{};seen.set(actual,out);for(const key of Object.keys(actual))out[key]=hydrate(actual[key]);return out;}
const input=hydrate('0').resultData.runData['Request webhook'][0].data.main[0][0].json.body;
console.log(JSON.stringify(Object.keys(JSON.parse(input.payload)).sort()));
`,
      ]);
      assert.deepEqual(JSON.parse(trace!), [
        "endDate",
        "eventId",
        "loanId",
        "recipientId",
        "startDate",
        "status",
        "toolName",
        "type",
      ]);
      const response = await signedPost("overdue", "overdue-fetch", {
        cursor: null,
        limit: 50,
      });
      const fetched = await response.json();
      for (const loan of fetched.loans)
        assert.deepEqual(Object.keys(loan).sort(), [
          "endDate",
          "loanId",
          "recipientId",
          "reminderKey",
          "toolName",
        ]);
    },
  );
  if (browser)
    await check(
      "Listing forms, category history, trust controls and confirmation are keyboard operable",
      () => browser!.coreFlows(),
    );
  if (browser)
    await check(
      "Notification and automation screens retain the shared design at phone and desktop sizes",
      async () => {
        await browser!.notifications();
        const measured = await browser!.inspect();
        await writeFile(
          "test-results/ui-measurements.json",
          JSON.stringify(measured, null, 2),
        );
      },
    );
  await writeFile(
    "test-results/verification.json",
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        status: "pass",
        results,
        browser: !!browser,
      },
      null,
      2,
    ),
  );
  console.log(`Completed ${results.length} repeatable checks.`);
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
          .replaceAll(n8nSecret, "[redacted]")
          .replaceAll(reverseSecret, "[redacted]")
      : "Unknown verification error",
  );
  console.error(
    `Verification failed after ${results.length} completed checks. The last RUN line identifies the failing assertion.`,
  );
  await writeFile(
    "test-results/verification.json",
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        status: "failed",
        results,
        browser: !!browser,
      },
      null,
      2,
    ),
  ).catch(() => {});
  process.exitCode = 1;
} finally {
  const restorationErrors: string[] = [];
  async function restore(name: string, operation: () => Promise<unknown>) {
    try {
      await operation();
    } catch {
      restorationErrors.push(name);
    }
  }
  await restore("callback signing configuration", () =>
    envSet("N8N_TO_CONVEX_SECRET", reverseSecret),
  );
  await restore("workflow service", () => docker(["start", "n8n"]));
  await restore("workflow health", healthy);
  await restore("reminder schedule", () =>
    docker([
      "exec",
      "-T",
      "n8n",
      "n8n",
      "publish:workflow",
      "--id=LendLoopOverdue",
    ]),
  );
  await restore("workflow restart", () => docker(["restart", "n8n"]));
  await restore("restarted workflow health", healthy);
  await restore("fixture cleanup", () => cli("testing:cleanup", { runId }));
  if (browser)
    await restore("development account cleanup", () => browser!.cleanup());
  await restore("retry configuration", () =>
    envSet("AUTOMATION_BACKOFF_SECONDS", saved.backoff),
  );
  await restore("testing guard", () =>
    envSet("DEMO_SEED_ENABLED", saved.enabled),
  );
  await restore("environment validation", async () => {
    assert.equal(await envGet("AUTOMATION_BACKOFF_SECONDS"), saved.backoff);
    assert.equal(await envGet("DEMO_SEED_ENABLED"), saved.enabled);
    assert.equal(await envGet("N8N_TO_CONVEX_SECRET"), reverseSecret);
  });
  if (restorationErrors.length) {
    await writeFile(
      "test-results/verification.json",
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          status: "failed",
          results,
          browser: !!browser,
          restorationErrors,
        },
        null,
        2,
      ),
    ).catch(() => {});
    console.error("Restore failed: " + restorationErrors.join(", "));
    process.exitCode = 1;
  }
}
