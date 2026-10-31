"use client";
import { usePaginatedQuery } from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/session";
import { Empty, MoreResults } from "@/components/common";
import { label } from "@/lib/catalog";
export default function Home() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.listPublicAvailable,
    {},
    { initialNumItems: 20 },
  );
  const { authenticated } = useSession();
  return (
    <>
      <div className="page-heading">
        <h1>
          Borrow what you need.
          <br />
          Lend what you don&apos;t.
        </h1>
        <p>A neighborhood board for sharing tools.</p>
        {authenticated ? (
          <Link className="button primary" href="/tools">
            Browse tools
          </Link>
        ) : (
          <SignInButton mode="modal">
            <button className="primary">Sign in to lend or borrow</button>
          </SignInButton>
        )}
      </div>
      <section aria-labelledby="available-heading">
        <h2 id="available-heading">Available tools</h2>
        {status === "LoadingFirstPage" ? (
          <p role="status">Loading available tools...</p>
        ) : results.length === 0 && status === "Exhausted" ? (
          <Empty>No tools are available today. Check back soon.</Empty>
        ) : (
          <ul className="tool-grid">
            {results.map((tool, index) => (
              <li
                className="card"
                key={`${tool.name}-${tool.category}-${index}`}
              >
                <h3>{tool.name}</h3>
                <p>{label(tool.category)}</p>
              </li>
            ))}
          </ul>
        )}
        <MoreResults status={status} loadMore={loadMore} />
      </section>
    </>
  );
}
