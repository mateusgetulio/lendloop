import type { CSSProperties, ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "@/components/providers";
import { tokens } from "@/lib/design-tokens";
import "./globals.css";
export const metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  const style = Object.fromEntries(
    Object.entries(tokens.color).map(([key, value]) => [
      `--color-${key}`,
      value,
    ]),
  ) as CSSProperties;
  return (
    <ClerkProvider>
      <html lang="en" style={style}>
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
