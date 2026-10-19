import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectBox } from "@/components/crm/controls";
import { useCreateActivity } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fillTemplate, mailtoUrl, useTemplates, whatsappUrl } from "@/lib/templates";

type Lead = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
};

/** Compose from a template and open the user's own mail / WhatsApp app. No mail credentials live in the CRM;
 *  the message is optionally logged as an activity so the timeline stays complete. */
export function SendMessageDialog({
  open,
  onOpenChange,
  lead,
  ownerName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  ownerName: string;
}) {
  const { profile } = useAuth();
  const templates = useTemplates();
  const logAct = useCreateActivity();
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [log, setLog] = useState(true);

  const vars = useMemo(
    () => ({
      contact_name: lead.contact_name?.split(" ")[0] ?? "there",
      company_name: lead.company_name,
      owner_name: ownerName,
    }),
    [lead, ownerName],
  );
  const options = (templates.data ?? []).filter((t) => t.is_active && t.channel === channel);

  useEffect(() => {
    if (open) {
      setChannel(lead.email ? "email" : "whatsapp");
      setTemplateId("");
      setSubject("");
      setBody("");
      setLog(true);
    }
  }, [open, lead.email]);

  const pick = (id: string) => {
    setTemplateId(id);
    const t = options.find((x) => x.id === id);
    if (t) {
      setSubject(fillTemplate(t.subject ?? "", vars));
      setBody(fillTemplate(t.body, vars));
    }
  };

  const target = channel === "email" ? lead.email : lead.phone;
  const send = () => {
    if (!target || !body.trim()) return;
    const url = channel === "email" ? mailtoUrl(target, subject, body) : whatsappUrl(target, body);
    window.open(url, channel === "email" ? "_self" : "_blank", "noopener");
    if (log && profile) {
      logAct.mutate(
        {
          request_id: crypto.randomUUID(),
          lead_id: lead.id,
          user_id: profile.id,
          activity_type: channel === "email" ? "email" : "whatsapp",
          subject: subject || `${channel === "email" ? "Email" : "WhatsApp"} sent`,
          description: body.slice(0, 2000),
        },
        { onError: (e: Error) => toast.error(e.message) },
      );
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Message {lead.contact_name ?? lead.company_name}</DialogTitle>
          <DialogDescription>
            Opens your own {channel === "email" ? "email" : "WhatsApp"} app with the text filled in.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs">Channel</Label>
              <SelectBox
                value={channel}
                onChange={(v) => {
                  setChannel((v || "email") as "email" | "whatsapp");
                  setTemplateId("");
                }}
                options={[
                  { value: "email", label: "Email" },
                  { value: "whatsapp", label: "WhatsApp" },
                ]}
                className="w-full"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Template</Label>
              <SelectBox
                value={templateId}
                onChange={pick}
                options={options.map((t) => ({ value: t.id, label: t.name }))}
                placeholder="Choose a template"
                className="w-full"
              />
            </div>
          </div>
          {channel === "email" ? (
            <div>
              <Label htmlFor="msg-subject" className="mb-1.5 block text-xs">
                Subject
              </Label>
              <Input
                id="msg-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          ) : null}
          <div>
            <Label htmlFor="msg-body" className="mb-1.5 block text-xs">
              Message
            </Label>
            <Textarea
              id="msg-body"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {!target ? (
            <p role="alert" className="text-sm text-destructive">
              This lead has no {channel === "email" ? "email address" : "phone number"}.
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={log} onCheckedChange={(c) => setLog(c === true)} />
            Log this on the lead&apos;s timeline
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!target || !body.trim()} onClick={send}>
            Open in {channel === "email" ? "email app" : "WhatsApp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
