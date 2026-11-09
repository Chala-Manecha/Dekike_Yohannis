import { useEffect, useState } from "react";
import { initDataFromHash } from "../lib/telegram-webapp";

const KEY = "dy_tg_init";
const SIGNED_OUT = "dy_tg_signed_out";

declare global {
  interface Window {
    Telegram?: { WebApp?: { ready: () => void; expand: () => void; initData?: string } };
  }
}

/** Init data for this Telegram session (kept for the tab, since the URL fragment goes away after the first page). */
export function telegramInitData(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromHash = initDataFromHash(window.location.hash);
    if (fromHash) sessionStorage.setItem(KEY, fromHash);
    return fromHash ?? sessionStorage.getItem(KEY);
  } catch {
    return initDataFromHash(window.location.hash);
  }
}

export function markSignedOut() {
  try {
    sessionStorage.setItem(SIGNED_OUT, "1");
  } catch {}
}

/** "ok" = signed in; "unlinked" = this Telegram account isn't tied to a member yet (→ /link). */
export async function signInWithTelegram(initData: string, create = false): Promise<"ok" | "unlinked" | "failed"> {
  try {
    const res = await fetch("/api/auth/telegram-webapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, create }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; linked?: boolean } | null;
    if (!res.ok || !body) return "failed";
    if (body.linked === false) return "unlinked";
    try {
      sessionStorage.removeItem(SIGNED_OUT);
    } catch {}
    return "ok";
  } catch {
    return "failed";
  }
}

/**
 * When the site is opened inside Telegram (bot menu button), signs the member in
 * automatically and opens the app full height. Does nothing in a normal browser.
 */
export function TelegramMiniApp({ signedIn, label }: { signedIn: boolean; label: string }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const initData = telegramInitData();
    if (!initData) return;

    // Telegram's helper script: full-height window and a proper loading handoff
    if (!document.querySelector('script[src*="telegram-web-app.js"]')) {
      const s = document.createElement("script");
      s.src = "https://telegram.org/js/telegram-web-app.js";
      s.async = true;
      s.onload = () => {
        window.Telegram?.WebApp?.ready();
        window.Telegram?.WebApp?.expand();
      };
      document.head.appendChild(s);
    }

    let signedOut = false;
    try {
      signedOut = sessionStorage.getItem(SIGNED_OUT) === "1";
    } catch {}
    if (signedIn || signedOut) return;

    if (window.location.pathname === "/link") return;
    setBusy(true);
    signInWithTelegram(initData).then((r) => {
      if (r === "ok") window.location.replace(window.location.pathname + window.location.search);
      else if (r === "unlinked") window.location.replace("/link");
      else setBusy(false);
    });
  }, [signedIn]);

  return busy ? (
    <div className="tg-signing-in" role="status">
      <p>{label}</p>
    </div>
  ) : null;
}
