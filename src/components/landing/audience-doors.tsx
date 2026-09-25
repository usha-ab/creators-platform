import { useTranslations } from "next-intl";
import { Palette, Store, Sparkles, ArrowRight } from "lucide-react";

/**
 * De tre dörrarna in i kretsloppet — en per publik. "Jag vill uppleva" är
 * visuellt primär, eftersom den är den vanligaste vägen in.
 *
 * Dörren leder till rollens sida, inte rakt in i registreringen. Den som
 * klickar "Jag är kreatör" vet ofta inte vad plattformen ger en kreatör, och
 * ett konto man skapar utan att veta varför blir inte använt. Rollsidan
 * förklarar först och skickar sedan vidare till registreringen med rollen
 * förvald.
 *
 * `size="large"` används där dörrarna är sidans huvudval och inte ett inslag
 * bland andra.
 */
export function AudienceDoors({ size = "default" }: { size?: "default" | "large" }) {
  const t = useTranslations("landing.doors");
  const large = size === "large";

  const doors = [
    { href: "/for-kreatorer", icon: Palette, label: t("creatorLabel"), desc: t("creatorDesc"), primary: false },
    { href: "/for-platser", icon: Store, label: t("venueLabel"), desc: t("venueDesc"), primary: false },
    { href: "/for-publik", icon: Sparkles, label: t("audienceLabel"), desc: t("audienceDesc"), primary: true },
  ];

  return (
    <div className={`grid w-full text-left sm:grid-cols-3 ${large ? "gap-5 sm:gap-6" : "gap-4 sm:gap-5"}`}>
      {doors.map((d) => (
        <a
          key={d.href}
          href={d.href}
          className={`group rounded-2xl border transition hover:scale-[1.01] ${large ? "p-7 sm:p-8" : "p-6"} ${
            d.primary
              ? "glow-gold border-[var(--usha-gold)]/40 bg-gradient-to-br from-[var(--usha-gold)]/10 to-[var(--usha-accent)]/5"
              : "border-[var(--usha-border)] bg-[var(--usha-card)] hover:border-[var(--usha-gold)]/30"
          }`}
        >
          <div
            className={`mb-4 flex items-center justify-center rounded-xl bg-gradient-to-br from-[var(--usha-gold)]/20 to-[var(--usha-accent)]/20 ${
              large ? "h-12 w-12" : "h-10 w-10"
            }`}
          >
            <d.icon size={large ? 22 : 18} className="text-[var(--usha-gold)]" />
          </div>
          {/* Pilen syns alltid i stort läge. En pil som bara dyker upp vid hover
              finns inte alls på en pekskärm, och då läser kortet som en ruta
              text i stället för som något man trycker på. */}
          <div className={`flex items-center gap-1.5 font-bold ${large ? "text-lg sm:text-xl" : ""}`}>
            {d.label}
            <ArrowRight
              size={large ? 18 : 14}
              className={
                large
                  ? "text-[var(--usha-gold)] transition group-hover:translate-x-0.5"
                  : "-translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100"
              }
            />
          </div>
          <p className={`mt-1.5 text-[var(--usha-muted)] ${large ? "text-sm sm:text-base" : "text-sm"}`}>{d.desc}</p>
        </a>
      ))}
    </div>
  );
}
