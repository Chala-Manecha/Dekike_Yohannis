import { useT } from "../lib/use-t";
import { PageHead, TabBar, type Tab } from "./Layout";

/** Header and section buttons shared by every Finance & Audit page. */
export function FinanceHead({ active, toReview, canSettings, sub }: { active: "review" | "month" | "ledger" | "settings"; toReview?: number; canSettings: boolean; sub?: string }) {
  const { tr } = useT();
  const f = tr.finance;
  const tabs: Tab[] = [
    { key: "review", to: "/finance", label: f.queueTitle, icon: "🧾", count: toReview, alert: true },
    { key: "month", to: "/finance/month", label: f.monthTitle, icon: "📊" },
    { key: "ledger", to: "/finance/ledger", label: tr.ledger.title, icon: "📒" },
    ...(canSettings ? [{ key: "settings", to: "/finance/settings", label: f.settingsTitle, icon: "⚙️" }] : []),
  ];
  return (
    <>
      <PageHead back={{ to: "/dashboard", label: tr.nav.dashboard }} title={f.title} sub={sub} />
      <TabBar tabs={tabs} active={active} />
    </>
  );
}
