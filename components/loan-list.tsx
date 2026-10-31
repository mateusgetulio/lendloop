"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Badge, Confirm, Empty, MoreResults, message } from "./common";
type Loan = FunctionReturnType<typeof api.loans.list>["page"][number];
export function LoanList({ view }: { view: "borrowing" | "incoming" }) {
  const { results, status, loadMore } = usePaginatedQuery(
      api.loans.list,
      { view },
      { initialNumItems: 20 },
    ),
    settings = useQuery(api.clock.settings),
    transition = useMutation(api.loans.transition);
  const [confirm, setConfirm] = useState<{
      loan: Loan;
      action: "cancel" | "return";
    } | null>(null),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function act(
    loan: Loan,
    action: "approve" | "decline" | "cancel" | "return",
  ) {
    setBusy(loan._id);
    setError("");
    setNotice("");
    try {
      await transition({ loanId: loan._id, action });
      setConfirm(null);
      setNotice(
        action === "return"
          ? "Loan marked as returned."
          : `Request ${action === "cancel" ? "cancelled" : action === "approve" ? "approved" : "declined"}.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  const day = settings?.today;
  return (
    <>
      <h1>{view === "borrowing" ? "My requests" : "Incoming requests"}</h1>
      <p>
        {view === "borrowing"
          ? "Track the tools you have asked to borrow."
          : "Manage requests for your tools. Confirm each return when the tool is back."}
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && !confirm && <p role="alert">{error}</p>}
      {status === "LoadingFirstPage" ? (
        <p role="status">Loading requests...</p>
      ) : results.length === 0 ? (
        <Empty
          action={
            <Link
              className="button"
              href={view === "borrowing" ? "/tools" : "/my-listings"}
            >
              {view === "borrowing" ? "Browse tools" : "Manage listings"}
            </Link>
          }
        >
          {view === "borrowing"
            ? "You haven't requested a tool yet."
            : "You have no incoming requests yet."}
        </Empty>
      ) : (
        <ul className="loan-list">
          {results.map((loan) => (
            <li className="card" key={loan._id}>
              <h2>{loan.toolName}</h2>
              <Badge>
                {loan.status === "approved" && day && loan.endDate < day
                  ? "Overdue"
                  : loan.status === "pending" && day && loan.startDate < day
                    ? "Expired"
                    : loan.status}
              </Badge>
              <p>
                {loan.startDate} to {loan.endDate}
              </p>
              <p>
                {view === "borrowing" ? "Lent by" : "Requested by"}{" "}
                {loan.otherPartyName}
              </p>
              <div className="actions">
                {loan.status === "pending" && loan.isOwner && (
                  <>
                    {day && loan.startDate >= day && (
                      <button
                        disabled={busy === loan._id}
                        onClick={() => void act(loan, "approve")}
                      >
                        Approve
                      </button>
                    )}
                    <button
                      disabled={busy === loan._id}
                      onClick={() => void act(loan, "decline")}
                    >
                      Decline
                    </button>
                  </>
                )}
                {loan.status === "pending" && loan.isBorrower && (
                  <button
                    disabled={busy === loan._id}
                    onClick={() => void act(loan, "cancel")}
                  >
                    Cancel request
                  </button>
                )}
                {loan.status === "approved" &&
                  day &&
                  loan.startDate > day &&
                  (loan.isBorrower || loan.isOwner) && (
                    <button
                      onClick={() => {
                        setError("");
                        setConfirm({ loan, action: "cancel" });
                      }}
                    >
                      Cancel loan
                    </button>
                  )}
                {loan.status === "approved" &&
                  day &&
                  loan.startDate <= day &&
                  loan.isOwner && (
                    <button
                      onClick={() => {
                        setError("");
                        setConfirm({ loan, action: "return" });
                      }}
                    >
                      Confirm return
                    </button>
                  )}
                {busy === loan._id && <span role="status">Saving...</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <MoreResults status={status} loadMore={loadMore} />
      {confirm && (
        <Confirm
          title={confirm.action === "return" ? "Confirm return" : "Cancel loan"}
          description={
            confirm.action === "return"
              ? "Confirm that the tool is back with its lender. This releases the reserved dates."
              : "Cancel this approved reservation? The dates will become available again."
          }
          busy={busy !== null}
          error={error}
          action={() => void act(confirm.loan, confirm.action)}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
