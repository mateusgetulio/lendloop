"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { ConvexError } from "convex/values";
export function message(error: unknown) {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "Something went wrong. Please try again.";
}
export function Badge({ children }: { children: ReactNode }) {
  const text = String(children);
  const tone =
    text === "Available today" || text === "returned"
      ? "success"
      : text === "Overdue"
        ? "danger"
        : text === "pending" || text === "Expired"
          ? "warning"
          : text === "approved"
            ? "info"
            : "neutral";
  return (
    <span className={`badge ${tone}`}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </span>
  );
}
export function Empty({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}
export function MoreResults({
  status,
  loadMore,
}: {
  status: string;
  loadMore: (n: number) => void;
}) {
  return status === "CanLoadMore" ? (
    <button onClick={() => loadMore(20)}>Load more</button>
  ) : status === "LoadingMore" ? (
    <p role="status">Loading more...</p>
  ) : null;
}
export function Confirm({
  title,
  description,
  action,
  onClose,
  busy,
  error,
}: {
  title: string;
  description: string;
  action: () => void;
  onClose: () => void;
  busy: boolean;
  error: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector("h2")?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="confirm-title" tabIndex={-1}>
        {title}?
      </h2>
      <p>{description}</p>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button onClick={onClose} disabled={busy}>
          {title.toLowerCase().includes("listing")
            ? "Keep listing"
            : title === "Cancel loan"
              ? "Keep loan"
              : "Not returned yet"}
        </button>
        <button className="danger" onClick={action} disabled={busy}>
          {busy ? "Saving..." : title}
        </button>
      </div>
    </dialog>
  );
}
