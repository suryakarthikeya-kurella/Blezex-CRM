import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDirectory } from "@/lib/api";

const ALL = "__all";
export type Opt = { value: string; label: string };

/** Select with an optional "All" choice (Radix forbids empty-string values, so a sentinel is mapped to ""). */
export function SelectBox({
  value,
  onChange,
  options,
  allLabel,
  placeholder,
  className,
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly Opt[];
  allLabel?: string;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value === "" && allLabel ? ALL : value}
      onValueChange={(v) => onChange(v === ALL ? "" : v)}
      disabled={disabled ?? false}
    >
      <SelectTrigger
        className={className ?? "w-44"}
        aria-label={ariaLabel ?? placeholder ?? allLabel}
      >
        <SelectValue placeholder={placeholder ?? allLabel} />
      </SelectTrigger>
      <SelectContent>
        {allLabel ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Pager({
  page,
  total,
  pageSize = 25,
  onPage,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
      <span>
        {total === 0
          ? "No results"
          : `${page * pageSize + 1}–${Math.min(total, (page + 1) * pageSize)} of ${total}`}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          disabled={page <= 0}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2">
          Page {page + 1} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          disabled={page + 1 >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function useUserName() {
  const { data } = useDirectory();
  return (id: string | null | undefined) =>
    id ? (data?.byId.get(id)?.full_name ?? "Unknown user") : "Unassigned";
}

export function userOptions(
  list: { id: string; full_name: string }[] | undefined,
  roles?: string[],
): Opt[] {
  return (list ?? [])
    .filter((u) => !roles || roles.includes((u as { role?: string }).role ?? ""))
    .map((u) => ({ value: u.id, label: u.full_name || "Unnamed" }));
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-xs font-medium">
      <span className="mb-1.5 block">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}
