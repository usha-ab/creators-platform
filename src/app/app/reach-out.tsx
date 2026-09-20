"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import { profileShareUrl } from "@/lib/profiles/share-link";
import { Check, Copy, Download, Link2, Palette, QrCode } from "lucide-react";

/**
 * Nå ut — de tre verktygen för att få folk till sin sida.
 *
 * QR-koden, den egna adressen och whitelabel fanns alla sedan tidigare, men
 * bodde på /dashboard/profile, som bara nås genom att öppna profilmenyn. Ingen
 * som inte redan visste att de fanns hittade dem: Bacchi Syre var live i tre
 * dygn med en 36 tecken lång UUID som enda adress och Ushas egna färger på sin
 * sida, för att ingen sagt att det gick att ändra.
 *
 * Panelen visas bara när profilen är publik. Innan dess finns ingen sida att
 * sprida, och då är det här bara brus ovanpå kom-igång-checklistan.
 */
export function ReachOut({
  profileId,
  slug,
  isPublic,
  whitelabelEnabled,
  shareToken = null,
}: {
  profileId: string;
  slug: string | null;
  isPublic: boolean;
  whitelabelEnabled: boolean;
  /** Dold profil: länken bär token, QR:en ritas inte. */
  shareToken?: string | null;
}) {
  const t = useTranslations("reachOut");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Adressen följer slug när den finns. Byter man slug byter QR-koden mål av
  // sig själv — den gamla utskriften slutar dock fungera, vilket är skälet att
  // be om adressen FÖRE man trycker flygblad.
  const path = slug || profileId;
  // Dold profil delas med token — den rena adressen är en 404 för mottagaren.
  // QR:en förblir avstängd i det läget: en hemlig nyckel på en affisch är
  // ingen hemlighet (se effekten nedan, som redan avbryter när !isPublic).
  const url = profileShareUrl("https://usha.se", path, { isPublic, shareToken });
  const rentVisningsnamn = slug ? `usha.se/${slug}` : `usha.se/creators/${profileId.slice(0, 8)}…`;
  // Dold profil: säg att länken bär en nyckel, annars ser den ut som den rena
  // adressen och någon klipper bort frågesträngen i tron att den är skräp.
  const visning = isPublic ? rentVisningsnamn : `${rentVisningsnamn} + nyckel`;

  useEffect(() => {
    if (!isPublic) return;
    let avbruten = false;
    QRCode.toDataURL(url, {
      width: 512,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((u) => {
        if (!avbruten) setDataUrl(u);
      })
      .catch(() => {
        /* Utan bild försvinner nedladdningsknappen, resten fungerar. */
      });
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 96,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }).catch(() => {});
    }
    return () => {
      avbruten = true;
    };
  }, [url, isPublic]);

  // Publik profil: panelen som förut. Dold profil MED delningstoken: samma
  // panel, men bara länken — det är hela poängen med att kunna visa sig för
  // utvalda. Dold UTAN token: inget att sprida, alltså inget att visa.
  if (!isPublic && !shareToken) return null;
  const visaQr = isPublic;

  function laddaNer() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `usha-qr-${path}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function kopiera() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Adressen står i klartext bredvid, så den går att markera för hand. */
    }
  }

  return (
    <section
      aria-labelledby="reach-out-heading"
      className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4 sm:p-5"
    >
      <h2 id="reach-out-heading" className="text-sm font-semibold">
        {t("heading")}
      </h2>
      <p className="mt-0.5 text-xs text-[var(--usha-muted)]">{t("intro")}</p>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        {visaQr && (
        <div className="flex shrink-0 flex-col items-center gap-2">
          <span className="rounded-lg bg-white p-2">
            <canvas ref={canvasRef} aria-label={t("qrAlt")} />
          </span>
          <button
            type="button"
            onClick={laddaNer}
            disabled={!dataUrl}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--usha-gold)] disabled:opacity-40"
          >
            <Download size={13} />
            {t("download")}
          </button>
        </div>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2.5">
            <Link2 size={14} className="shrink-0 text-[var(--usha-muted)]" />
            <span className="min-w-0 flex-1 truncate text-xs">{visning}</span>
            <button
              type="button"
              onClick={kopiera}
              aria-label={t("copy")}
              className="shrink-0 text-[var(--usha-muted)] transition hover:text-[var(--usha-gold)]"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>

          {/* Den långa UUID-adressen fungerar, men går inte att säga högt eller
              trycka på ett flygblad. Erbjud den korta innan något trycks. */}
          {!slug && (
            <Link
              href="/dashboard/profile#slug-section"
              className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--usha-gold)]/40 px-3 py-2.5 text-xs font-medium text-[var(--usha-gold)] transition hover:bg-[var(--usha-gold)]/5"
            >
              <QrCode size={14} />
              {t("chooseAddress")}
            </Link>
          )}

          {!whitelabelEnabled && (
            <Link
              href="/dashboard/profile#whitelabel"
              className="flex items-center gap-2 rounded-xl border border-[var(--usha-border)] px-3 py-2.5 text-xs text-[var(--usha-muted)] transition hover:border-[var(--usha-gold)]/40 hover:text-[var(--usha-white)]"
            >
              <Palette size={14} />
              {t("brandIt")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
