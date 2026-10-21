import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const statusTone = (v: string): "info" | "success" | "warning" | "danger" | "muted" => {
  switch (v) {
    case "won":
    case "completed":
    case "paid":
    case "active":
    case "approved":
    case "accepted":
      return "success";
    case "lost":
    case "rejected":
    case "cancelled":
    case "churned":
    case "failed":
    case "overdue":
      return "danger";
    case "negotiation":
    case "proposal_sent":
    case "nurture":
    case "partially_paid":
    case "waiting_for_client":
    case "renewal_due":
    case "in_progress":
    case "pending":
    case "unpaid":
    case "paused":
    case "sent":
      return "warning";
    case "new":
    case "researching":
    case "qualified":
    case "contacted":
    case "interested":
    case "meeting_scheduled":
    case "onboarding":
    case "maintenance":
    case "todo":
    case "issued":
    case "on_leave":
      return "info";
    default:
      return "muted";
  }
};

const toneClass: Record<string, string> = {
  success: "bg-success/12 text-success border-success/25",
  danger: "bg-destructive/12 text-destructive border-destructive/25",
  warning: "bg-warning/15 text-warning border-warning/30",
  info: "bg-primary/10 text-primary border-primary/25",
  muted: "bg-muted text-muted-foreground border-border",
};

export function StatusPill({ value, className }: { value: string; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClass[statusTone(value)],
        className,
      )}
    >
      {value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

export function PriorityPill({ value }: { value: string }) {
  const map: Record<string, string> = {
    high: "bg-destructive/12 text-destructive border-destructive/25",
    medium: "bg-warning/15 text-warning border-warning/30",
    low: "bg-muted text-muted-foreground border-border",
  };
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        map[value] ?? map["low"],
      )}
    >
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "primary";
}) {
  const accents: Record<string, string> = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  };
  return (
    <div className="surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <p className={cn("mt-2 font-display text-2xl font-semibold", accents[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{message}</p>;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
    >
      <p className="font-medium">Couldn&apos;t load this data.</p>
      <p className="mt-1 opacity-90">
        {error instanceof Error ? error.message : "Unexpected error"}
      </p>
      {onRetry ? (
        <button onClick={onRetry} className="mt-2 text-xs font-medium underline">
          Try again
        </button>
      ) : null}
    </div>
  );
}
