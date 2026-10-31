"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section>
      <h1>Something went wrong</h1>
      <p>Your request could not be loaded. Please try again.</p>
      <button onClick={reset}>Try again</button>
    </section>
  );
}
