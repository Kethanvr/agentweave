"use client";

import { ArrowRight, CheckCircle2, LockKeyhole, Radio, ShieldCheck } from "lucide-react";
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
          <p className="muted">Sign in with the account provided by your organization.</p>
          <label>
            Work email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
          </label>
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
