import {
  data,
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import { LangChooser } from "./components/LangChooser";
import { LangSwitch } from "./components/LangSwitch";
import { GROUP } from "./config";
import { t } from "./lib/i18n";
import { chosenLang, DEFAULT_LANG, langCookie } from "./lib/lang";
import { can } from "./lib/permissions";
import { getUser } from "./lib/session.server";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Noto+Sans+Ethiopic:wght@400;600&family=Noto+Serif+Ethiopic:wght@500;700&family=Spectral:wght@500;700&family=Noto+Sans:wght@400;600&display=swap",
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getUser(request, context.cloudflare.env);
  const chosen = chosenLang(request.headers.get("Cookie"));
  // Renew the cookie on page loads so the choice never expires for regular visitors.
  const headers = chosen && request.method === "GET" ? { "Set-Cookie": langCookie(chosen) } : undefined;
  return data({
    lang: chosen ?? DEFAULT_LANG,
    langChosen: chosen !== null,
    user,
    nav: {
      events: user ? can(user.role, "event:manage") : false,
      tasks: user ? can(user.role, "task:view") && !can(user.role, "event:manage") : false,
      finance: user ? can(user.role, "finance:view") : false,
      members: user ? can(user.role, "member:list") : false,
      feedback: user ? can(user.role, "feedback:read") : false,
    },
  }, { headers });
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const lang = data?.lang ?? DEFAULT_LANG;
  const tr = t(lang);
  // First visit: nothing else is usable until they pick a language.
  const askLang = Boolean(data && !data.langChosen);
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1F2E6B" />
        <Meta />
        <Links />
      </head>
      <body>
        {askLang && <LangChooser />}
        <header className="site-header" inert={askLang}>
          <Link to="/" className="wordmark">
            <span>{tr.groupName}</span>
            <small>{tr.groupSub}</small>
          </Link>
          <nav aria-label="Main">
            <NavLink to="/" end>{tr.nav.home}</NavLink>
            <NavLink to="/gallery">{tr.nav.gallery}</NavLink>
            {data?.user ? <NavLink to="/me">{tr.nav.myPage}</NavLink> : <NavLink to="/register">{tr.nav.register}</NavLink>}
            {data?.nav.events && <NavLink to="/events">{tr.nav.events}</NavLink>}
            {data?.nav.tasks && <NavLink to="/tasks">{tr.nav.tasks}</NavLink>}
            {data?.nav.finance && <NavLink to="/finance">{tr.nav.finance}</NavLink>}
            {data?.nav.members && <NavLink to="/members">{tr.nav.members}</NavLink>}
            {data?.nav.feedback && <NavLink to="/feedback/inbox">{tr.nav.feedback}</NavLink>}
            {!data?.user && <NavLink to="/login">{tr.nav.signIn}</NavLink>}
          </nav>
          {data && <LangSwitch current={lang} />}
        </header>
        <main inert={askLang}>{children}</main>
        <footer className="site-footer" inert={askLang}>
          <div className="tilet tilet--thin" aria-hidden="true" />
          <p>
            <a href={GROUP.telegramGroup} target="_blank" rel="noreferrer">{tr.home.joinTelegram}</a>
          </p>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const lang = useRouteLoaderData<typeof loader>("root")?.lang ?? DEFAULT_LANG;
  const e = t(lang).errors;
  let title = e.generic;
  let detail = "";
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? e.notFound : error.status === 403 ? e.forbidden : `${error.status}`;
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
  }
  return (
    <section className="page narrow">
      <h1>{title}</h1>
      {detail && <pre>{detail}</pre>}
      <p><Link to="/">{e.goHome}</Link></p>
    </section>
  );
}
