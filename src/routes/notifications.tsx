import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/crm/ui-bits";
import { Button } from "@/components/ui/button";
import { useMarkRead, useNotifications } from "@/lib/api";
import { dateTime } from "@/lib/format";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});

function Page() {
  const q = useNotifications();
  const mark = useMarkRead();
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <Button size="sm" variant="outline" onClick={() => mark.mutate(undefined)}>
            Mark all read
          </Button>
        }
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState message="You're all caught up." />
      ) : (
        <ul className="space-y-2">
          {(q.data ?? []).map((n) => (
            <li key={n.id} className={`surface p-3 text-sm ${n.read_at ? "opacity-60" : ""}`}>
              <p className="font-medium">{n.title}</p>
              {n.message ? <p className="text-muted-foreground">{n.message}</p> : null}
              <p className="text-[11px] text-muted-foreground">{dateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
