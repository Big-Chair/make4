import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "./supabaseClient";
import { FigmaLogo } from "./FigmaDecorations";

type Status = "loading" | "success" | "error";

export function OAuthConsent() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    // ── 1. Explicit error from Supabase / Spotify ──────────────────────────
    const urlError = params.get("error") || hashParams.get("error");
    const urlErrorCode = params.get("error_code") || hashParams.get("error_code");
    const urlErrorDesc = params.get("error_description") || hashParams.get("error_description");

    if (urlError) {
      const friendlyMessages: Record<string, string> = {
        provider_email_needs_verification:
          "Supabase requires email confirmation for new OAuth accounts.\nFix: Supabase Dashboard → Authentication → Settings → Email Auth → disable \"Enable email confirmations\".",
        over_email_send_rate_limit:
          "Email rate limit exceeded — Supabase is trying to send confirmation emails for OAuth sign-ups.\nFix: Supabase Dashboard → Authentication → Settings → Email Auth → disable \"Enable email confirmations\".\nThen wait a few minutes and try again.",
      };
      const msg =
        (urlErrorCode && friendlyMessages[urlErrorCode]) ||
        (urlErrorDesc ? decodeURIComponent(urlErrorDesc).replace(/\+/g, " ") : urlError.replace(/_/g, " "));
      setErrorMsg(msg);
      setStatus("error");
      return;
    }

    // ── 2. Detect whether we actually have an auth callback in the URL ─────
    // PKCE flow: ?code=... | Implicit flow: #access_token=...
    const hasAuthCode = params.has("code") || hashParams.has("access_token");

    // If neither error nor auth code, this page was visited directly — go home
    if (!hasAuthCode) {
      navigate("/", { replace: true });
      return;
    }

    // ── 3. Wait for Supabase to exchange the code / token ──────────────────
    let settled = false;

    const succeed = (session: { user: { user_metadata: Record<string, string>; email?: string } }) => {
      if (settled) return;
      settled = true;
      const meta = session.user.user_metadata;
      setDisplayName(meta?.full_name || meta?.name || meta?.preferred_username || session.user.email || "Spotify User");
      setAvatarUrl(meta?.avatar_url || meta?.picture || null);
      setStatus("success");
      setTimeout(() => navigate("/", { replace: true }), 2200);
    };

    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      setErrorMsg(msg);
      setStatus("error");
    };

    // Listen for SIGNED_IN (fires once Supabase exchanges the PKCE code)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        succeed(session as any);
      }
      // Ignore INITIAL_SESSION / SIGNED_OUT — they fire on every page load
    });

    // Fallback: session may already be set before the listener fires
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) succeed(session as any);
    });

    // Timeout: give Supabase 20 s to exchange the code before surfacing an error
    const timeout = setTimeout(() => {
      fail("Connection timed out. The auth code may have expired — please try signing in again.");
    }, 20_000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center relative overflow-hidden"
      style={{ background: "#1E1E1E" }}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        className="absolute -top-32 -left-32 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(29,185,84,0.12) 0%, transparent 70%)" }}
      />
      <div
        className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(162,89,255,0.1) 0%, transparent 70%)" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative flex flex-col items-center gap-8 px-8 py-10 rounded-3xl"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px)",
          minWidth: "340px",
          maxWidth: "420px",
          width: "90vw",
        }}
      >
        <FigmaLogo size={36} />

        <div className="flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#1DB954">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          <span className="text-lg font-semibold text-white" style={{ fontFamily: "Inter, sans-serif" }}>
            Spotify
          </span>
        </div>

        <AnimatePresence mode="wait">
          {/* ── LOADING ── */}
          {status === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-5 w-full"
            >
              <div className="relative w-16 h-16">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
                  className="absolute inset-0 rounded-full"
                  style={{ border: "3px solid rgba(29,185,84,0.15)", borderTopColor: "#1DB954" }}
                />
                <div
                  className="absolute inset-2 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(29,185,84,0.08)" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#1DB954">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                </div>
              </div>

              <div className="text-center">
                <p className="text-base font-semibold text-white" style={{ fontFamily: "Inter, sans-serif" }}>
                  Connecting to Spotify
                </p>
                <p className="text-sm mt-1.5" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "Inter, sans-serif" }}>
                  Verifying your account…
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.3, ease: "easeInOut" }}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "#1DB954" }}
                  />
                ))}
              </div>

              <div
                className="w-full rounded-2xl px-4 py-3 flex flex-col gap-2"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "Inter, sans-serif" }}>
                  Permissions granted
                </p>
                {["Read your playlists", "See your collaborative playlists", "See what's currently playing"].map((scope) => (
                  <div key={scope} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(29,185,84,0.15)" }}>
                      <svg width="8" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="#1DB954" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)", fontFamily: "Inter, sans-serif" }}>{scope}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── SUCCESS ── */}
          {status === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", damping: 18 }}
              className="flex flex-col items-center gap-5 w-full"
            >
              <div className="relative">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", damping: 14, delay: 0.1 }}
                  className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center"
                  style={{ border: "2px solid #1DB954", boxShadow: "0 0 20px rgba(29,185,84,0.35)", background: "rgba(29,185,84,0.12)" }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="#1DB954">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                    </svg>
                  )}
                </motion.div>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", damping: 12, delay: 0.35 }}
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: "#1DB954", border: "2px solid #1E1E1E" }}
                >
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.div>
              </div>

              <div className="text-center">
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="text-base font-semibold text-white"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  {displayName ? `Welcome, ${displayName}!` : "Connected!"}
                </motion.p>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  style={{ color: "rgba(255,255,255,0.4)", marginTop: "6px", fontFamily: "Inter, sans-serif" }}
                  className="text-sm"
                >
                  Returning to your game…
                </motion.p>
              </div>

              <div className="w-full h-0.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <motion.div
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2.0, ease: "easeInOut" }}
                  className="h-full rounded-full"
                  style={{ background: "#1DB954" }}
                />
              </div>
            </motion.div>
          )}

          {/* ── ERROR ── */}
          {status === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-5 w-full"
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(242,78,30,0.1)", border: "2px solid rgba(242,78,30,0.3)" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#F24E1E" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              <div className="w-full text-center">
                <p className="text-base font-semibold text-white" style={{ fontFamily: "Inter, sans-serif" }}>
                  Authorization failed
                </p>
                <div
                  className="mt-3 w-full rounded-2xl px-4 py-3 text-left flex flex-col gap-2"
                  style={{ background: "rgba(242,78,30,0.06)", border: "1px solid rgba(242,78,30,0.2)" }}
                >
                  {errorMsg.split("\n").map((line, i) => (
                    <p
                      key={i}
                      style={{
                        color: i === 0 ? "#F24E1E" : "rgba(255,255,255,0.45)",
                        fontSize: i === 0 ? "var(--text-xs)" : "var(--text-xs)",
                        fontFamily: "Inter, sans-serif",
                        lineHeight: "1.5",
                      }}
                    >
                      {line}
                    </p>
                  ))}
                </div>
                <a
                  href="https://supabase.com/dashboard/project/_/auth/providers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 no-underline text-xs"
                  style={{ color: "#1DB954", fontFamily: "Inter, sans-serif" }}
                >
                  Open Supabase Auth Settings →
                </a>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => navigate("/", { replace: true })}
                  className="flex-1 py-2.5 rounded-full cursor-pointer text-sm"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.6)",
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  ← Back
                </button>
                <button
                  onClick={() => navigate("/", { replace: true })}
                  className="flex-1 py-2.5 rounded-full cursor-pointer text-sm"
                  style={{
                    background: "#1DB954",
                    border: "none",
                    color: "white",
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  Try again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.18)", fontFamily: "Inter, sans-serif" }}>
          Powered by Supabase Auth · Make 4
        </p>
      </motion.div>
    </div>
  );
}
