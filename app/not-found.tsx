import Link from "next/link";
export default function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <Link className="button" href="/">
        Return to LendLoop
      </Link>
    </>
  );
}
