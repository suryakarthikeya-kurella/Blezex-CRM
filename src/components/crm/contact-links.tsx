import { Mail, MessageCircle, Phone } from "lucide-react";

/** Digits only, for tel: and wa.me. */
const digits = (p: string) => p.replace(/[^\d+]/g, "");
const waNumber = (p: string) => p.replace(/\D/g, "");

const cls = "inline-flex items-center gap-1 text-primary hover:underline";

export function EmailLink({ email }: { email: string | null | undefined }) {
  if (!email) return <>—</>;
  return (
    <a href={`mailto:${email}`} className={`${cls} break-all`}>
      <Mail className="size-3.5 shrink-0" /> {email}
    </a>
  );
}

/** Click-to-call plus a WhatsApp chat link. Numbers need a country code for WhatsApp to open the right chat. */
export function PhoneLinks({ phone }: { phone: string | null | undefined }) {
  if (!phone) return <>—</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <a href={`tel:${digits(phone)}`} className={cls}>
        <Phone className="size-3.5 shrink-0" /> {phone}
      </a>
      <a
        href={`https://wa.me/${waNumber(phone)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        aria-label={`WhatsApp ${phone}`}
      >
        <MessageCircle className="size-3.5 shrink-0" /> WhatsApp
      </a>
    </span>
  );
}
