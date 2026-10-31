"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/session";
import {
  Badge,
  Band,
  Confirm,
  Empty,
  MoreResults,
  message,
} from "@/components/common";
import type { Tool } from "@/components/tool-card";
import { AutomationPanel } from "@/components/automation-panel";
import { formatRange } from "@/lib/catalog";
import { LoanActivity } from "@/components/loan-activity";
function Administration() {
  const loans = usePaginatedQuery(api.admin.loans, {}, { initialNumItems: 10 }),
    lenders = usePaginatedQuery(api.admin.lenders, {}, { initialNumItems: 10 }),
    tools = usePaginatedQuery(api.tools.list, {}, { initialNumItems: 10 });
  const day = useQuery(api.clock.settings)?.today;
  const trust = useMutation(api.admin.trust),
    remove = useMutation(api.tools.remove);
  const [deleting, setDeleting] = useState<Tool | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <>
      <Band
        eyebrow="Neighborhood oversight"
        title="Administration"
        lede="Oversee loans, Trusted Lender status and listings."
      />
      {error && !deleting && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section>
        <h2 className="section-title">All loans</h2>
        {loans.status === "LoadingFirstPage" ? (
          <p role="status">Loading loans...</p>
        ) : !loans.results.length ? (
          <Empty>No loans have been requested yet.</Empty>
        ) : (
          <div className="table-panel">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Lender</th>
                  <th>Borrower</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {loans.results.map((l) => (
                  <tr key={l._id}>
                    <td data-label="Tool">{l.toolName}</td>
                    <td data-label="Lender">{l.lenderName}</td>
                    <td data-label="Borrower">{l.borrowerName}</td>
                    <td data-label="Dates">
                      {formatRange(l.startDate, l.endDate)}
                    </td>
                    <td data-label="Status">
                      <Badge>
                        {l.status === "approved" && day && l.endDate < day
                          ? "Overdue"
                          : l.status}
                      </Badge>
                    </td>
                    <td data-label="Activity">
                      <LoanActivity loanId={l._id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <MoreResults status={loans.status} loadMore={loans.loadMore} />
      </section>
      <section>
        <h2 className="section-title">Trusted Lenders</h2>
        {lenders.status === "LoadingFirstPage" ? (
          <p role="status">Loading lenders...</p>
        ) : !lenders.results.length ? (
          <Empty>No accounts yet.</Empty>
        ) : (
          <div className="table-panel">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Active listings</th>
                  <th>Status</th>
                  <th>
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lenders.results.map((l) => (
                  <tr key={l._id}>
                    <td data-label="Account">{l.displayName}</td>
                    <td data-label="Active listings">
                      {l.listingNames.length
                        ? l.listingNames.join(", ")
                        : "None"}
                    </td>
                    <td data-label="Status">
                      {l.trustedLender ? (
                        <span className="badge info">Trusted Lender</span>
                      ) : (
                        "Standard"
                      )}
                    </td>
                    <td className="cell-action">
                      <button
                        disabled={busy}
                        aria-pressed={l.trustedLender}
                        aria-label={`Trusted Lender for ${l.displayName}${l.listingNames.length ? `, lists ${l.listingNames.join(", ")}` : ""}`}
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          try {
                            await trust({
                              userId: l._id,
                              trusted: !l.trustedLender,
                            });
                            setNotice("Trusted Lender status updated.");
                          } catch (e) {
                            setError(message(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {l.trustedLender ? "Remove trust" : "Mark trusted"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <MoreResults status={lenders.status} loadMore={lenders.loadMore} />
      </section>
      <section>
        <h2 className="section-title">Active listings</h2>
        {tools.status === "LoadingFirstPage" ? (
          <p role="status">Loading listings...</p>
        ) : !tools.results.length ? (
          <Empty>No active listings to remove.</Empty>
        ) : (
          <div className="table-panel">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Lender</th>
                  <th>Today</th>
                  <th>
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tools.results.map((t) => (
                  <tr key={t._id}>
                    <td data-label="Tool">{t.name}</td>
                    <td data-label="Lender">{t.ownerName}</td>
                    <td data-label="Today">
                      <Badge>{t.availability}</Badge>
                    </td>
                    <td className="cell-action">
                      <button
                        aria-label={`Remove listing ${t.name}`}
                        onClick={() => {
                          setError("");
                          setDeleting(t);
                        }}
                      >
                        Remove listing
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <MoreResults status={tools.status} loadMore={tools.loadMore} />
      </section>
      <AutomationPanel />
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
      <Band
        eyebrow="Neighborhood oversight"
        title="Administrator access required"
        lede="This account cannot manage other neighbors' listings."
      />
    </>
  );
}
