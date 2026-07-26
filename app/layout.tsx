import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prep — interview OS",
  description:
    "An AI-native learning OS for technical interview prep: roadmaps, persistent notes, spaced-repetition recall, and an honest progress dashboard.",
};

// Runs before first paint so the saved theme is applied with no flash.
// Default is dark (matches the profiles.theme default in the schema).
const noFlashTheme = `
(function () {
  try {
    var t = localStorage.getItem("prep-theme");
    if (t !== "light" && t !== "dark") t = "dark";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
