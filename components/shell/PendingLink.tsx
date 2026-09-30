"use client";

import Link, { useLinkStatus } from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * A <Link> that says when its navigation is in flight. For links into routes
 * that deliberately have no loading.tsx (/roadmap/[id] and the topic route can
 * 404, so they must not stream), where the click would otherwise look ignored.
 */
export default function PendingLink({
  href,
  children,
  style,
  className,
}: {
  href: string;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <Link href={href} className={className} style={style}>
      <Label>{children}</Label>
    </Link>
  );
}

// useLinkStatus only works in a descendant of the <Link> it reports on.
function Label({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span className={pending ? "is-navigating" : undefined} aria-busy={pending || undefined}>
      {children}
      {pending && <span style={{ marginLeft: "8px", color: "var(--text-faint)" }}>opening…</span>}
    </span>
  );
}
