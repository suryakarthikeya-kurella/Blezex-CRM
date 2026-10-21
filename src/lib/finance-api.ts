import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "./supabase";
import type { Overview, SeriesRow } from "./finance";

/** Every Finance read goes through admin-gated views/RPCs (RLS + an explicit admin check in SQL); the UI only mirrors that. */
export const frpc = async <T>(fn: string, args?: Record<string, unknown>) =>
  unwrap<T>(await supabase.rpc(fn, args as never));

export const useOverview = (from: string, to: string) =>
  useQuery({
    queryKey: ["finance", "overview", from, to],
    queryFn: () => frpc<Overview>("finance_overview", { p_from: from, p_to: to }),
  });

export const useSeries = (from: string, to: string, bucket: "month" | "year") =>
  useQuery({
    queryKey: ["finance", "series", from, to, bucket],
    queryFn: () =>
      frpc<SeriesRow[]>("finance_series", { p_from: from, p_to: to, p_bucket: bucket }),
  });

/** After any money write, every dependent number (dashboard, reports, balances) must refetch. */
export function invalidateFinance(qc: QueryClient) {
  for (const k of ["finance", "invoices", "report", "services", "config"])
    void qc.invalidateQueries({ queryKey: [k] });
}
