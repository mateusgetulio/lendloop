import type { CSSProperties, ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "@/components/providers";
import { SessionLayout } from "@/components/session";
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
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: tokens.color.primary,
          colorForeground: tokens.color.text,
          colorBackground: tokens.color.page,
          fontFamily: "system-ui, sans-serif",
          fontSize: "16px",
        },
        elements: {
          modalContent: { width: "calc(100vw - 8px)", maxWidth: "400px" },
          card: { padding: "16px" },
          otpCodeFieldInput: {
            width: "44px",
            height: "44px",
            minWidth: "44px",
          },
          otpCodeFieldInputs: { gap: "2px" },
          formButtonPrimary: { minHeight: "44px" },
          formFieldInput: { minHeight: "44px" },
        },
      }}
    >
      <html lang="en" style={style}>
        <body>
          <Providers>
            <SessionLayout>{children}</SessionLayout>
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
