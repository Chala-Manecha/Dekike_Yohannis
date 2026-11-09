import { useEffect, useRef, useState } from "react";

type TelegramUser = Record<string, string | number>;

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void;
  }
}

/**
 * Telegram Login Widget. Requires the site's domain to be set on the bot with
 * BotFather (/setdomain). data-request-access="write" lets the bot message the
 * member later (notifications).
 */
export function TelegramLogin({
  botUsername,
  next,
  busyText,
  failedText,
}: {
  botUsername: string;
  next: string;
  busyText: string;
  failedText: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.onTelegramAuth = async (tgUser) => {
      setBusy(true);
      setError(null);
      const res = await fetch("/api/auth/sign-in/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tgUser),
      });
      if (res.ok) {
        window.location.assign(next);
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ? `${failedText} (${body.message})` : failedText);
        setBusy(false);
      }
    };

    const container = ref.current;
    if (!container) return;
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "6");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    container.appendChild(script);
    return () => {
      container.innerHTML = "";
      delete window.onTelegramAuth;
    };
  }, [botUsername, next, failedText]);

  return (
    <div className="tg-login">
      <div ref={ref} aria-busy={busy} />
      {busy && <p className="muted">{busyText}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
