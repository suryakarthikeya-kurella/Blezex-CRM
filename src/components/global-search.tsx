import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, CheckSquare, Search, Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { safeSearch } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Hit = { id: string; title: string; sub: string };
type Results = { leads: Hit[]; clients: Hit[]; tasks: Hit[] };

/** Ctrl/⌘+K search across leads, clients and tasks. Queries run as the signed-in user, so row-level security
 *  already limits results to what that person may see. */
export function GlobalSearch() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setTerm(safeSearch(text)), 250);
    return () => clearTimeout(t);
  }, [text]);

  const q = useQuery({
    queryKey: ["global-search", term],
    enabled: open && term.length >= 2,
    staleTime: 15_000,
    queryFn: async (): Promise<Results> => {
      const like = (cols: string[]) => cols.map((c) => `${c}.ilike.%${term}%`).join(",");
      const [leads, clients, tasks] = await Promise.all([
        supabase
          .from("leads")
          .select("id,company_name,contact_name,lead_number")
          .or(like(["company_name", "contact_name", "email", "phone", "lead_number"]))
          .limit(6),
        supabase
          .from("clients")
          .select("id,company_name,contact_name,client_number")
          .or(like(["company_name", "contact_name", "email", "client_number"]))
          .limit(6),
        supabase.from("tasks").select("id,title,status").ilike("title", `%${term}%`).limit(6),
      ]);
      const rows = <T,>(r: { data: T[] | null; error: { message: string } | null }) => {
        if (r.error) throw new Error(r.error.message);
        return r.data ?? [];
      };
      return {
        leads: rows(leads).map((l) => ({
          id: l.id,
          title: l.company_name,
          sub: `${l.lead_number}${l.contact_name ? ` · ${l.contact_name}` : ""}`,
        })),
        clients: rows(clients).map((c) => ({
          id: c.id,
          title: c.company_name,
          sub: `${c.client_number}${c.contact_name ? ` · ${c.contact_name}` : ""}`,
        })),
        tasks: rows(tasks).map((t) => ({ id: t.id, title: t.title, sub: t.status })),
      };
    },
  });

  const go = (fn: () => void) => {
    setOpen(false);
    setText("");
    fn();
  };
  const r = q.data;
  const empty = !!r && !r.leads.length && !r.clients.length && !r.tasks.length;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" />
        <span className="hidden md:inline">Search</span>
        <kbd className="hidden rounded border px-1.5 text-[10px] md:inline">Ctrl K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Search leads, clients and tasks</DialogTitle>
          {/* server-side search: cmdk's own client-side filtering is switched off */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search leads, clients, tasks…"
              value={text}
              onValueChange={setText}
            />
            <CommandList>
              {term.length < 2 ? (
                <p className="p-4 text-sm text-muted-foreground">Type at least 2 characters.</p>
              ) : q.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Searching…</p>
              ) : q.isError ? (
                <p role="alert" className="p-4 text-sm text-destructive">
                  Search failed. Try again.
                </p>
              ) : null}
              {empty ? <CommandEmpty>No matches.</CommandEmpty> : null}
              {r?.leads.length ? (
                <CommandGroup heading="Leads">
                  {r.leads.map((h) => (
                    <CommandItem
                      key={h.id}
                      value={`lead-${h.id}`}
                      onSelect={() =>
                        go(() => void nav({ to: "/leads/$leadId", params: { leadId: h.id } }))
                      }
                    >
                      <Users className="size-4" /> {h.title}{" "}
                      <span className="ml-2 text-xs text-muted-foreground">{h.sub}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {r?.clients.length ? (
                <CommandGroup heading="Clients">
                  {r.clients.map((h) => (
                    <CommandItem
                      key={h.id}
                      value={`client-${h.id}`}
                      onSelect={() =>
                        go(() => void nav({ to: "/clients/$clientId", params: { clientId: h.id } }))
                      }
                    >
                      <Briefcase className="size-4" /> {h.title}{" "}
                      <span className="ml-2 text-xs text-muted-foreground">{h.sub}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {r?.tasks.length ? (
                <CommandGroup heading="Tasks">
                  {r.tasks.map((h) => (
                    <CommandItem
                      key={h.id}
                      value={`task-${h.id}`}
                      onSelect={() => go(() => void nav({ to: "/tasks" }))}
                    >
                      <CheckSquare className="size-4" /> {h.title}{" "}
                      <span className="ml-2 text-xs text-muted-foreground">{h.sub}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
