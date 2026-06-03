import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { AppShell } from "@/components/shell";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "AutoCyber",
  description: "AI security engineer for AI-built startup stacks."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const app = <AppShell>{children}</AppShell>;
  const body = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>{app}</ClerkProvider>
  ) : (
    app
  );

  return (
    <html lang="en">
      <body>{body}</body>
    </html>
  );
}
