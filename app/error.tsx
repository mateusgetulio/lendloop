"use client";
import Link from "next/link";
import { Band } from "@/components/common";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <>
      <Band
        eyebrow="Please try again"
        title="This page could not load"
        lede="Retry the page or return to the tool list."
      />
      <div className="actions">
        <button className="primary" onClick={reset}>
          Try again
        </button>
        <Link className="button" href="/tools">
          Browse tools
        </Link>
      </div>
    </>
  );
}
