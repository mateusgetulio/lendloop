"use client";
import { useEffect, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MoreResults } from "./common";

const labels: Record<string, string> = {
  requested: "Request sent",
  approved: "Approval sent",
  declined: "Decline sent",
  cancelled: "Cancellation sent",
  returned: "Return confirmed",
  overdue: "Reminder sent",
};
function relative(time: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
export function LoanActivity({ loanId }: { loanId: Id<"loans"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.activity.list,
    { loanId },
    { initialNumItems: 5 },
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="activity" aria-label="Loan activity">
      {status === "LoadingFirstPage" ? (
        <p role="status">Loading activity...</p>
      ) : !results.length ? (
        <p>No updates delivered yet. Check back after delivery.</p>
      ) : (
        <ul>
          {results.map((item, index) => (
            <li key={`${item.kind}-${item.occurredAt}-${index}`}>
              {labels[item.kind] ?? "Update sent"}{" "}
              <time
                dateTime={new Date(item.occurredAt).toISOString()}
                title={new Date(item.occurredAt).toLocaleString()}
              >
                {relative(item.occurredAt, now)}
              </time>
            </li>
          ))}
        </ul>
      )}
      <MoreResults status={status} loadMore={loadMore} />
    </div>
  );
}
