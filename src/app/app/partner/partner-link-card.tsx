"use client";

import { useState } from "react";
import { Copy, Check, Share2 } from "lucide-react";

interface Labels {
  copy: string;
  copied: string;
  share: string;
  shareTitle: string;
  shareText: string;
}

export function PartnerLinkCard({ link, labels }: { link: string; labels: Labels }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blockerad – länken syns ändå i fältet
    }
  }

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: labels.shareTitle, text: labels.shareText, url: link });
        return;
      } catch {
        // avbrutet – fall tillbaka på kopiera
      }
    }
    await copy();
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm"
      />
      <button
        onClick={copy}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] px-4 py-2 text-sm font-medium transition hover:border-[var(--usha-gold)]/40"
      >
        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        {copied ? labels.copied : labels.copy}
      </button>
      <button
        onClick={share}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
      >
        <Share2 size={14} />
        {labels.share}
      </button>
    </div>
  );
}
