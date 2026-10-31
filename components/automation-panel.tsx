"use client";
import { useEffect, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Empty, MoreResults, message } from "./common";
import { formatDay } from "@/lib/catalog";
export function AutomationPanel() {
  const summary = useQuery(api.automation.summary),
    failed = usePaginatedQuery(
      api.automation.failed,
      {},
      { initialNumItems: 20 },
    ),
    failures = usePaginatedQuery(
      api.automation.failures,
      {},
      { initialNumItems: 20 },
    );
  const retry = useMutation(api.automation.retry);
  const [now, setNow] = useState(Date.now),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section aria-labelledby="automation-heading">
      <h2 className="section-title" id="automation-heading">
        Automation
      </h2>
      {summary ? (
        <div className="panel">
          <p>
            Pending notifications: <strong>{summary.pendingCount}</strong>
          </p>
          <p>
            Oldest pending age:{" "}
            {summary.oldestPendingAt === null
              ? "None"
              : `${Math.max(0, Math.floor((now - summary.oldestPendingAt) / 60000))} minutes`}
          </p>
          <p>
            Overdue loans missing today&apos;s reminder:{" "}
            <strong>{summary.missingCount}</strong>
          </p>
        </div>
      ) : (
        <p role="status">Loading automation summary...</p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h3>Failed notifications</h3>
      {failed.status === "LoadingFirstPage" ? (
        <p role="status">Loading failed notifications...</p>
      ) : !failed.results.length ? (
        <Empty>
          No failed notifications. Pending deliveries retry automatically.
        </Empty>
      ) : (
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Update</th>
                <th>Attempts</th>
                <th>Failure</th>
                <th>
                  <span className="visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {failed.results.map((e) => (
                <tr key={e._id}>
                  <td data-label="Tool">{e.toolName}</td>
                  <td data-label="Update">{e.type}</td>
                  <td data-label="Attempts">{e.attempts}</td>
                  <td data-label="Failure">{e.lastError}</td>
                  <td className="cell-action">
                    <button
                      aria-label={`Retry notification for ${e.toolName}`}
                      disabled={busy === e._id}
                      onClick={async () => {
                        setBusy(e._id);
                        setError("");
                        try {
                          await retry({ eventId: e._id });
                          setNotice("Notification queued for retry.");
                        } catch (err) {
                          setError(message(err));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === e._id ? "Saving..." : "Retry"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreResults status={failed.status} loadMore={failed.loadMore} />
      <h3>Missing reminders</h3>
      {summary?.missingCount ? (
        <>
          <div className="table-panel">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Due date</th>
                </tr>
              </thead>
              <tbody>
                {summary.missingReminders.map((l) => (
                  <tr key={l.loanId}>
                    <td data-label="Tool">{l.toolName}</td>
                    <td data-label="Due date">{formatDay(l.endDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.missingCount > 50 && (
            <p>
              Showing 50 of {summary.missingCount}. Scheduled recovery will
              retry missing reminders.
            </p>
          )}
        </>
      ) : summary ? (
        <Empty>No overdue loans are missing a reminder today.</Empty>
      ) : null}
      <h3>Recorded workflow failures</h3>
      {failures.status === "LoadingFirstPage" ? (
        <p role="status">Loading workflow failures...</p>
      ) : !failures.results.length ? (
        <Empty>No workflow failures have been recorded.</Empty>
      ) : (
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Details</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {failures.results.map((f) => (
                <tr key={f._id}>
                  <td data-label="Source">{f.source}</td>
                  <td data-label="Details">{f.message}</td>
                  <td data-label="Recorded">
                    <time dateTime={new Date(f.createdAt).toISOString()}>
                      {new Date(f.createdAt).toLocaleString()}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreResults status={failures.status} loadMore={failures.loadMore} />
    </section>
  );
}
