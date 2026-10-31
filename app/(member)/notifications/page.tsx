"use client";
import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Band, Empty, MoreResults } from "@/components/common";
export default function Page() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.notifications.list,
    {},
    { initialNumItems: 20 },
  );
  return (
    <>
      <Band
        eyebrow="Your neighborhood"
        title="Notifications"
        lede="Updates about your requests and overdue loans."
      />
      {status === "LoadingFirstPage" ? (
        <p role="status">Loading notifications...</p>
      ) : !results.length ? (
        <Empty
          action={
            <Link className="button" href="/tools">
              Browse tools
            </Link>
          }
        >
          You have no notifications yet.
        </Empty>
      ) : (
        <ul className="loan-list">
          {results.map((n) => (
            <li className="card" key={n._id}>
              <p className="eyebrow">{n.kind}</p>
              <p>{n.message}</p>
              <p className="note">
                <time dateTime={new Date(n.occurredAt).toISOString()}>
                  {new Date(n.occurredAt).toLocaleString()}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
      <MoreResults status={status} loadMore={loadMore} />
    </>
  );
}
