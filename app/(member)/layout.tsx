import type { ReactNode } from "react";
import { MemberGate } from "@/components/session";
export default function Layout({ children }: { children: ReactNode }) {
  return <MemberGate>{children}</MemberGate>;
}
