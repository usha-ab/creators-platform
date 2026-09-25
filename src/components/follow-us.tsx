import { getTranslations } from "next-intl/server";
import { Facebook, Instagram, Music2 } from "lucide-react";
import { getSocialLinks } from "@/lib/follows/social-links";

/**
 * "Följ oss" – Ushas egna kanaler. Renderas bara för de kanaler som har en
 * adress i app_config.social_links.
 */
export async function FollowUs({ className = "" }: { className?: string }) {
  const links = await getSocialLinks();
  // Vit glyf på fylld cirkel i kanalens egen färg. Facebook-blått och
  // Instagrams gradient känns igen på avstånd; en grå ring gjorde det inte.
  // TikTok är svart och behöver en kant för att synas mot mörkt tema.
  const items = [
    {
      key: "facebook" as const,
      href: links.facebook,
      Icon: Facebook,
      brand: "bg-[#1877F2] text-white border-transparent",
    },
    {
      key: "instagram" as const,
      href: links.instagram,
      Icon: Instagram,
      brand:
        "bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285aeb_90%)] text-white border-transparent",
    },
    {
      key: "tiktok" as const,
      href: links.tiktok,
      Icon: Music2,
      brand: "bg-black text-white border-white/25",
    },
  ].filter((i): i is typeof i & { href: string } => !!i.href);
  if (items.length === 0) return null;

  const t = await getTranslations("followUs");
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--usha-muted)]">{t("heading")}</span>
      {items.map(({ key, href, Icon, brand }) => (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer me"
          aria-label={t(key)}
          title={t(key)}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition hover:scale-105 hover:opacity-90 ${brand}`}
        >
          <Icon size={16} />
        </a>
      ))}
    </div>
  );
}
