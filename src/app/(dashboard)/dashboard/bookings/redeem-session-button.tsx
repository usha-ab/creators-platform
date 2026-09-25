"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { redeemSession } from "./actions";
import { useToast } from "@/components/ui/toaster";
import { Music, Check } from "lucide-react";

export function RedeemSessionButton({
  bookingId,
  redeemed,
  total,
}: {
  bookingId: string;
  redeemed: number;
  total: number;
}) {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const t = useTranslations("bookingsPage");
  const allDone = redeemed >= total;

  function handle() {
    if (allDone) return;
    startTransition(async () => {
      const result = await redeemSession(bookingId);
      if ("error" in result) {
        toast.error(t("redeemRedeemError"), result.error);
        return;
      }
      if (result.reachedTotal) {
        toast.success(t("redeemAllDoneTitle"), t("redeemAllDoneBody"));
      } else {
        toast.success(t("redeemProgressToast", { redeemed: result.redeemed, total: result.total }));
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={isPending || allDone}
      className="flex items-center gap-1 rounded-lg bg-[var(--usha-gold)]/10 px-3 py-1.5 text-xs font-medium text-[var(--usha-gold)] hover:bg-[var(--usha-gold)]/20 disabled:opacity-50"
    >
      {allDone ? <Check size={12} /> : <Music size={12} />}
      {allDone ? t("redeemAllDoneButton", { total }) : t("redeemButton", { redeemed, total })}
    </button>
  );
}

export function DanceCounter({ redeemed, total }: { redeemed: number; total: number }) {
  const t = useTranslations("bookingsPage");
  return (
    <span className="flex items-center gap-1 rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-xs font-medium text-[var(--usha-gold)]">
      <Music size={10} />
      {t("danceCounter", { redeemed, total })}
    </span>
  );
}
