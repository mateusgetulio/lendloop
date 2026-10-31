"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/session";
import {
  Badge,
  Confirm,
  Empty,
  MoreResults,
  message,
} from "@/components/common";
import type { Tool } from "@/components/tool-card";
function Administration() {
  const loans = usePaginatedQuery(api.admin.loans, {}, { initialNumItems: 20 }),
    lenders = usePaginatedQuery(api.admin.lenders, {}, { initialNumItems: 20 }),
    tools = usePaginatedQuery(api.tools.list, {}, { initialNumItems: 20 });
  const day = useQuery(api.clock.settings)?.today;
  const trust = useMutation(api.admin.trust),
    remove = useMutation(api.tools.remove);
  const [deleting, setDeleting] = useState<Tool | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <>
      <h1>Administration</h1>
      {error && !deleting && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section>
        <h2>All loans</h2>
        {loans.status === "LoadingFirstPage" ? (
          <p role="status">Loading loans...</p>
        ) : !loans.results.length ? (
          <Empty>No loans have been requested yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Lender</th>
                <th>Borrower</th>
                <th>Dates</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loans.results.map((l) => (
                <tr key={l._id}>
                  <td data-label="Tool">{l.toolName}</td>
                  <td data-label="Lender">{l.lenderName}</td>
                  <td data-label="Borrower">{l.borrowerName}</td>
                  <td data-label="Dates">
                    {l.startDate} to {l.endDate}
                  </td>
                  <td data-label="Status">
                    <Badge>
                      {l.status === "approved" && day && l.endDate < day
                        ? "Overdue"
                        : l.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <MoreResults status={loans.status} loadMore={loans.loadMore} />
      </section>
      <section>
        <h2>Trusted Lenders</h2>
        {lenders.status === "LoadingFirstPage" ? (
          <p role="status">Loading lenders...</p>
        ) : !lenders.results.length ? (
          <Empty>No accounts yet.</Empty>
        ) : (
          <ul className="loan-list">
            {lenders.results.map((l) => (
              <li className="card" key={l._id}>
                <h3>{l.displayName}</h3>
                <p>
                  {l.listingNames.length
                    ? `Lists: ${l.listingNames.join(", ")}`
                    : "No active listings"}
                </p>
                <button
                  disabled={busy}
                  aria-pressed={l.trustedLender}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await trust({ userId: l._id, trusted: !l.trustedLender });
                      setNotice("Trusted Lender status updated.");
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {l.trustedLender
                    ? "Remove Trusted Lender"
                    : "Mark as Trusted Lender"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <MoreResults status={lenders.status} loadMore={lenders.loadMore} />
      </section>
      <section>
        <h2>Active listings</h2>
        {tools.status === "LoadingFirstPage" ? (
          <p role="status">Loading listings...</p>
        ) : !tools.results.length ? (
          <Empty>No active listings to remove.</Empty>
        ) : (
          <ul className="loan-list">
            {tools.results.map((t) => (
              <li className="card" key={t._id}>
                <h3>{t.name}</h3>
                <p>Lent by {t.ownerName}</p>
                <button
                  onClick={() => {
                    setError("");
                    setDeleting(t);
                  }}
                >
                  Remove listing
                </button>
              </li>
            ))}
          </ul>
        )}
        <MoreResults status={tools.status} loadMore={tools.loadMore} />
      </section>
      {deleting && (
        <Confirm
          title="Remove listing"
          description={`Remove ${deleting.name}? Pending requests will be declined and future reservations cancelled. Started loans stay open and returnable.`}
          busy={busy}
          error={error}
          onClose={() => setDeleting(null)}
          action={async () => {
            setBusy(true);
            try {
              await remove({ toolId: deleting._id });
              setDeleting(null);
              setNotice("Listing removed.");
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
export default function Page() {
  const { user } = useSession();
  return user?.role === "admin" ? (
    <Administration />
  ) : (
    <>
      <h1>Administrator access required</h1>
      <p>This account cannot manage other neighbors&apos; listings.</p>
    </>
  );
}
