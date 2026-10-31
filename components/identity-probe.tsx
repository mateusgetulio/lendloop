"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/** Temporary sign-in check, replaced by the authenticated layout. */
export function IdentityProbe() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const identity = useQuery(api.spike.identity, isAuthenticated ? {} : "skip");
  return (
    <section aria-labelledby="identity-heading">
      <h2 id="identity-heading">Sign-in check</h2>
      {isLoading ? (
        <p role="status">Checking authentication…</p>
      ) : isAuthenticated ? (
        <>
          <UserButton />
          <p role="status">
            {identity
              ? `Convex authenticated: ${identity.authenticated}. Display name: ${identity.displayNameFallback}.`
              : "Waiting for Convex identity…"}
          </p>
        </>
      ) : (
        <SignInButton mode="modal">
          <button type="button">Sign in</button>
        </SignInButton>
      )}
    </section>
  );
}
