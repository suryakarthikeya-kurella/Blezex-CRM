import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { financeSectionsFor } from "@/lib/permissions";

export const Route = createFileRoute("/finance")({
  head: () => ({ meta: [{ title: "Finance — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <FinanceLayout />
    </AppShell>
  ),
});

/** Section tabs; mentors and employees only have one section, so they get no tab bar. Access itself is enforced by the route guard and RLS. */
function FinanceLayout() {
  const { role } = useAuth();
  const sections = financeSectionsFor(role);
  return (
    <>
      {sections.length > 1 ? (
        <nav aria-label="Finance sections" className="mb-6 flex gap-1 overflow-x-auto border-b">
          {sections.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              activeOptions={{ exact: true }}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground"
              activeProps={{ className: "border-primary text-foreground" }}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <Outlet />
    </>
  );
}
