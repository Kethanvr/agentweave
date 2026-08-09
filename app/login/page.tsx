"use client";

import { ArrowRight, CheckCircle2, LockKeyhole, Radio, ShieldCheck, TriangleAlert, UserRoundCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { useAuth } from "@/components/providers";
import { nhost } from "@/lib/nhost";

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "AgentWeaveDemo@2026";
  const demoAccounts = [
    { label: "Owner", email: "owner@orga.agentweave.demo" },
    { label: "Editor", email: "editor@orga.agentweave.demo" },
    { label: "Viewer", email: "viewer@orga.agentweave.demo" },
  ];

  useEffect(() => {
    if (!loading && session) router.replace("/workflows");
  }, [loading, session, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await nhost.auth.signInEmailPassword({ email, password });
      if (!response.body.session) throw new Error("Sign-in requires an additional verification step.");
      router.replace("/workflows");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <Logo />
        <div className="story-copy">
          <span className="eyebrow light"><Radio size={14} /> Live orchestration</span>
          <h1>Build agent workflows your team can trust.</h1>
          <p>Design, run, approve, and audit AI-powered operations without giving up tenant isolation or control.</p>
          <ul className="feature-list">
            <li><CheckCircle2 /> Live step-by-step execution</li>
            <li><ShieldCheck /> Organization and role isolation</li>
            <li><LockKeyhole /> Protected approval gates</li>
          </ul>
        </div>
        <p className="story-footnote">Powered by Nhost, Hasura, PostgreSQL, and Gemini.</p>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <span className="eyebrow">AgentWeave workspace</span>
          <h2>Welcome back</h2>
          <p className="muted">Sign in with one of your organization accounts.</p>
          <label>
            Work email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
          </label>
          <aside className="demo-access-card" aria-label="Public demonstration accounts">
            <div className="demo-access-heading">
              <TriangleAlert size={17} />
              <div>
                <strong>Public demo access</strong>
                <p>Shown only for reviewer convenience. This card and these shared credentials must be removed in a real production deployment.</p>
              </div>
            </div>
            <div className="demo-account-list">
              {demoAccounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(demoPassword);
                  }}
                >
                  <UserRoundCheck size={14} />
                  <span><strong>{account.label}</strong><small>{account.email}</small></span>
                  <em>Use</em>
                </button>
              ))}
            </div>
            <p className="demo-password"><span>Shared password</span><code>{demoPassword}</code></p>
          </aside>
          {error && <div className="alert error">{error}</div>}
          <button className="button primary wide" disabled={submitting} type="submit">
            {submitting ? <><span className="spinner small" /> Signing in…</> : <>Sign in <ArrowRight size={17} /></>}
          </button>
          <p className="form-note"><ShieldCheck size={14} /> Access is enforced again by Hasura on every request.</p>
        </form>
      </section>
    </main>
  );
}
