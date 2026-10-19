import { useQuery } from "@tanstack/react-query";
import { supabase, unwrap } from "./supabase";

export type MessageTemplate = {
  id: string;
  name: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  is_active: boolean;
};

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    staleTime: 60_000,
    queryFn: async () =>
      unwrap(
        await supabase.from("message_templates").select("*").order("channel").order("name"),
      ) as MessageTemplate[],
  });
}

/** Replace {{placeholders}}; unknown placeholders are left visible so the sender notices them. */
export function fillTemplate(text: string, vars: Record<string, string | null | undefined>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => {
    const v = vars[k.toLowerCase()];
    return v ? v : m;
  });
}

export const mailtoUrl = (to: string, subject: string, body: string) =>
  `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const whatsappUrl = (phone: string, body: string) =>
  `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(body)}`;
