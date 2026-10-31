import Link from "next/link";
import { Band } from "@/components/common";
export default function NotFound() {
  return (
    <>
      <Band
        eyebrow="Check the address"
        title="Page unavailable"
        lede="This page does not exist. Browse the tools to continue."
      />
      <Link className="button" href="/tools">
        Browse tools
      </Link>
    </>
  );
}
