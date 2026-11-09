import { useEffect, useState } from "react";
import { signInWithTelegram, telegramInitData } from "./TelegramMiniApp";

type Labels = { open: string; steps: string[]; waiting: string; expired: string; botHint: string; retry: string; failed: string };

const POLL_MS = 2000;

/**
 * Sign-in through @DekikeYohannis_bot (see app/lib/bot-login.ts). Gets a one-time
 * link when the page opens, then checks every 2 s (and right away when the member
 * comes back from Telegram) until the bot confirms.
 */
export function BotLogin({ next, labels }: { next: string; labels: Labels }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "waiting" | "expired" | "error" | "telegram">("loading");
  const [initData, setInitData] = useState<string | null>(null);

  async function start() {
    setState("loading");
    try {
      const res = await fetch("/api/auth/bot-login/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await res.json()) as { url?: string };
      if (!res.ok || !body.url) throw new Error();
      setUrl(body.url);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    // Inside Telegram: one tap, no bot round-trip
    const tg = telegramInitData();
    if (tg) {
      setInitData(tg);
      setState("telegram");
    } else start();
  }, []);

  useEffect(() => {
    if (state !== "ready" && state !== "waiting") return;
    let stopped = false;
    async function poll() {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/auth/bot-login/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const body = (await res.json()) as { status?: string; ok?: boolean };
        if (stopped) return;
        if (body.ok) {
          stopped = true;
          window.location.assign(next);
        } else if (body.status === "expired") {
          stopped = true;
          setState("expired");
        }
      } catch {
        /* network blip: try again next tick */
      }
    }
    poll(); // at once: after a reload the member may already have confirmed
    const timer = setInterval(poll, POLL_MS);
    const onBack = () => poll();
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [state, next]);

  if (state === "telegram" && initData) {
    return (
      <div className="bot-login">
        <button
          type="button"
          className="btn btn-primary btn-telegram"
          onClick={async () => {
            if (await signInWithTelegram(initData)) window.location.assign(next);
            else setState("error");
          }}
        >
          {labels.open}
        </button>
      </div>
    );
  }

  return (
    <div className="bot-login">
      <ol className="bot-login-steps">
        {labels.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {(state === "ready" || state === "waiting") && url && (
        <a
          className="btn btn-primary btn-telegram"
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={() => setState("waiting")}
        >
          {labels.open}
        </a>
      )}
      {state === "loading" && <p className="muted">…</p>}
      {state === "waiting" && <p className="muted" role="status">{labels.waiting}</p>}
      {(state === "expired" || state === "error") && (
        <p role="alert">
          <span className="form-error">{state === "expired" ? labels.expired : labels.failed}</span>{" "}
          {state === "expired" && <span className="muted">{labels.botHint} </span>}
          <button type="button" className="btn btn-quiet btn-sm" onClick={start}>{labels.retry}</button>
        </p>
      )}
    </div>
  );
}
