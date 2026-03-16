import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tiba Render Studio",
  description: "Turn SketchUp drawings into photorealistic stone renders",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-stone-950 text-stone-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
