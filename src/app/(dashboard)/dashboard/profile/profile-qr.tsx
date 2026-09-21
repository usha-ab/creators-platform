"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Download, Copy, Check, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { useTranslations } from "next-intl";
import { profileShareUrl, mayRenderQr } from "@/lib/profiles/share-link";

export function ProfileQR({
  profileSlug,
  profileId,
  fullName,
  isPublic = true,
  shareToken = null,
}: {
  profileSlug: string | null;
  profileId: string;
  fullName: string | null;
  /** Dold profil: QR:en stängs av och länken bär token i stället. */
  isPublic?: boolean;
  shareToken?: string | null;
}) {
  const t = useTranslations("dashProfile.qr");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const slug = profileSlug || profileId;
  // Dold profil delas med token, publik profil på sin rena adress.
  const profileUrl = profileShareUrl("https://usha.se", slug, { isPublic, shareToken });
  // En QR-kod hamnar på väggar och flygblad. Bär den en hemlig token är den
  // ingen hemlighet längre, så den ritas bara för en publik profil.
  const showQr = mayRenderQr({ isPublic, shareToken });

  useEffect(() => {
    if (!showQr) return;
    let cancelled = false;
    QRCode.toDataURL(profileUrl, {
      width: 512,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("generateError"));
      });
    return () => {
      cancelled = true;
    };
  }, [profileUrl, toast, t, showQr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showQr) return;
    QRCode.toCanvas(canvas, profileUrl, {
      width: 192,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).catch(() => {});
  }, [profileUrl, showQr]);

  function handleDownload() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `usha-qr-${slug}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("copyError"));
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-[var(--usha-muted)]">
          {t("subtitle")}
        </p>
      </div>

      {!showQr && (
        <p className="rounded-xl border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/5 px-3 py-2.5 text-xs text-[var(--usha-muted)]">
          {t("hiddenNoQr")}
        </p>
      )}

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {showQr && (
          <div className="rounded-xl bg-white p-3">
            <canvas ref={canvasRef} aria-label={t("canvasAriaNamed", { name: fullName || t("canvasAriaFallback") })} />
          </div>
        )}

        <div className="flex w-full flex-col gap-2 sm:flex-1">
          <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2.5 text-xs text-[var(--usha-muted)] break-all">
            {profileUrl}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] py-2.5 text-sm font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              {copied ? t("copied") : t("copyLink")}
            </button>
            {/* Relativ väg, inte profileUrl: den är hårdkodad till usha.se för
                QR-kodens skull och skulle skicka dig till produktion från en
                preview-deploy eller localhost. */}
            <a
              href={showQr ? `/creators/${slug}` : `/creators/${slug}?k=${shareToken ?? ""}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] py-2.5 text-sm font-medium text-[var(--usha-muted)] transition hover:text-[var(--usha-white)]"
            >
              <ExternalLink size={14} />
              {t("preview")}
            </a>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!dataUrl}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] py-2.5 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            <Download size={14} />
            {t("download")}
          </button>
        </div>
      </div>
    </div>
  );
}
