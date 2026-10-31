"use client";
import { usePaginatedQuery } from "convex/react";
import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/session";
import { Band, Empty, MoreResults } from "@/components/common";
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
      <Band
        eyebrow="Neighborhood tool lending"
        title={
          <>
            Borrow what you need.
            <br />
            Lend what you don&apos;t.
          </>
        }
        lede="A neighborhood board for sharing tools."
      >
        <div className="band-action">
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
      </Band>
      <section aria-labelledby="available-heading">
        <h2 id="available-heading" className="section-title">
          Available today
        </h2>
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
                <p className="eyebrow">{label(tool.category)}</p>
                <h3 className="card-title">{tool.name}</h3>
              </li>
            ))}
          </ul>
        )}
        <MoreResults status={status} loadMore={loadMore} />
      </section>
    </>
  );
}
