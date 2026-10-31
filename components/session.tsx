"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { SignInButton, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Band } from "./common";
import type { FunctionReturnType } from "convex/server";
type User = NonNullable<FunctionReturnType<typeof api.users.current>["user"]>;
const Session = createContext<{
  user: User | null;
  loading: boolean;
  authenticated: boolean;
}>({ user: null, loading: true, authenticated: false });
export function useSession() {
  return useContext(Session);
}
export function SessionLayout({ children }: { children: ReactNode }) {
  const auth = useConvexAuth(),
    current = useQuery(api.users.current, auth.isAuthenticated ? {} : "skip"),
    ensure = useMutation(api.users.ensureCurrent);
  const [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [more, setMore] = useState(false);
  const { signOut } = useClerk();
  const pathname = usePathname();
  useEffect(() => {
    if (auth.isAuthenticated) {
      let active = true;
      ensure({}).catch(() => {
        if (active)
          setError("Your account could not be prepared. Please try again.");
      });
      return () => {
        active = false;
      };
    }
  }, [auth.isAuthenticated, ensure, retry]);
  useEffect(() => {
    if (!more) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMore(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [more]);
  const user = current?.user ?? null;
  const links = [
    ["/tools", "Tools"],
    ["/my-listings", "Listings"],
    ["/my-requests", "Requests"],
    ["/incoming", "Incoming"],
  ];
  return (
    <Session.Provider
      value={{
        user,
        loading: auth.isLoading || (auth.isAuthenticated && !user),
        authenticated: auth.isAuthenticated,
      }}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header>
        <div className="header-inner">
          <Link className="brand" href="/">
            LendLoop
          </Link>
          {auth.isAuthenticated && (
            <>
              <nav className="desktop-nav" aria-label="Main navigation">
                {links.map(([href, name]) => (
                  <Link
                    key={href}
                    href={href}
                    aria-current={pathname === href ? "page" : undefined}
                  >
                    {name}
                  </Link>
                ))}
                <Link
                  href="/notifications"
                  aria-current={
                    pathname === "/notifications" ? "page" : undefined
                  }
                >
                  Notifications
                </Link>
                {user?.role === "admin" && (
                  <Link
                    href="/admin"
                    aria-current={pathname === "/admin" ? "page" : undefined}
                  >
                    Admin
                  </Link>
                )}
              </nav>
              <div className="account desktop-account">
                <span className="account-name">
                  {user?.displayName ?? "Preparing account"}
                </span>
                <button onClick={() => void signOut({ redirectUrl: "/" })}>
                  Sign out
                </button>
              </div>
              <div className="mobile-more">
                <button
                  aria-expanded={more}
                  aria-controls="account-menu"
                  onClick={() => setMore(!more)}
                >
                  More
                </button>
                {more && (
                  <div id="account-menu" className="more-menu">
                    <Link href="/notifications" onClick={() => setMore(false)}>
                      Notifications
                    </Link>
                    {user?.role === "admin" && (
                      <Link href="/admin" onClick={() => setMore(false)}>
                        Admin
                      </Link>
                    )}
                    <button onClick={() => void signOut({ redirectUrl: "/" })}>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button
              onClick={() => {
                setError("");
                setRetry(retry + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          children
        )}
      </main>
      {auth.isAuthenticated && (
        <nav className="phone-nav" aria-label="Main navigation">
          {links.map(([href, name]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
            >
              {name}
            </Link>
          ))}
        </nav>
      )}
    </Session.Provider>
  );
}
export function MemberGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.loading) return <p role="status">Loading your account...</p>;
  if (!session.authenticated)
    return (
      <Band
        eyebrow="Members"
        title="Sign in to lend or borrow"
        lede="Your listings and requests are private to your account."
        action={
          <SignInButton mode="modal">
            <button className="primary">Sign in</button>
          </SignInButton>
        }
      />
    );
  return children;
}
