"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { categories, label } from "@/lib/catalog";
import { ToolCard } from "@/components/tool-card";
import { Band, Empty, MoreResults } from "@/components/common";
function Catalog() {
  const params = useSearchParams(),
    value = params.get("category"),
    category = categories.find((c) => c === value);
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.list,
    { category },
    { initialNumItems: 20 },
  );
  return (
    <>
      <Band
        eyebrow="Browse"
        title="Tools"
        lede="Availability is for today. Open a tool to check your dates."
      >
        <nav className="filters" aria-label="Filter by category">
          <Link href="/tools" aria-current={!category ? "page" : undefined}>
            All
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              href={`/tools?category=${c}`}
              aria-current={category === c ? "page" : undefined}
            >
              {label(c)}
            </Link>
          ))}
        </nav>
      </Band>
      {status === "LoadingFirstPage" ? (
        <p role="status">Loading tools...</p>
      ) : results.length === 0 ? (
        <Empty
          action={
            category ? (
              <Link className="button" href="/tools">
                Show all categories
              </Link>
            ) : (
              <Link className="button" href="/my-listings">
                List a tool
              </Link>
            )
          }
        >
          {category
            ? "No tools in this category yet."
            : "No tools have been listed yet."}
        </Empty>
      ) : (
        <ul className="tool-grid">
          {results.map((t) => (
            <ToolCard key={t._id} tool={t} />
          ))}
        </ul>
      )}
      <MoreResults status={status} loadMore={loadMore} />
    </>
  );
}
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading tools...</p>}>
      <Catalog />
    </Suspense>
  );
}
