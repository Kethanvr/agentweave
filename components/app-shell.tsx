"use client";

import { LogOut, Workflow } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/logo";
import { useAuth } from "@/components/providers";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session) {
    return <div className="page-loader"><span className="spinner" /> Securing your workspace…</div>;
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Logo />
        <nav className="sidebar-nav" aria-label="Primary navigation">
          <Link className={pathname.startsWith("/workflows") ? "nav-link active" : "nav-link"} href="/workflows">
            <Workflow size={18} /> Workflows
          </Link>
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{session.user?.email?.slice(0, 1).toUpperCase() ?? "U"}</span>
          <span className="user-copy">
            <strong>{session.user?.displayName || "AgentWeave user"}</strong>
            <small>{session.user?.email}</small>
          </span>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}

