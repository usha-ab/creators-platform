import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Music2 } from "lucide-react";
import { rankWishes, DJ_WISH_GOAL } from "@/lib/taxi/dj-wishes";
import { loadDjWishes } from "@/lib/taxi/dj-wishes-data";
import { addDjWish, voteDjWish } from "./dj-actions";

/**
 * "Önska DJ" visas på practicorna men gäller månadsfesten och festivalen:
 * practican har medvetet ingen bokad DJ. Gästerna önskar och röstar; vid 50
 * röster lovar arrangören att försöka boka DJ:n.
 */
export async function DjWishes({
  listingId,
  scopeKey,
  viewerId,
  backPath,
}: {
  listingId: string;
  scopeKey: string;
  viewerId: string | null;
  backPath: string;
}) {
  const t = await getTranslations("djWishes");
  const { wishes, votedIds } = await loadDjWishes(scopeKey, viewerId);
  const ranked = rankWishes(wishes).slice(0, 8);
  const input = "rounded-lg border border-[var(--usha-border)] bg-[var(--usha-black)] px-3 py-2 text-sm";

  return (
    <section id="dj" className="mb-8 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-5">
      <p className="flex items-center gap-2 font-semibold">
        <Music2 size={18} className="text-[var(--usha-gold)]" />
        {t("title")}
      </p>
      <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("body", { goal: DJ_WISH_GOAL })}</p>

      {ranked.length > 0 && (
        <ul className="mt-4 space-y-3">
          {ranked.map((w) => (
            <li key={w.id}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{w.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-[var(--usha-muted)]">
                    {w.status === "booked" ? t("booked") : w.reachedGoal ? t("booking") : `${w.votes} / ${DJ_WISH_GOAL}`}
                  </span>
                  {viewerId ? (
                    votedIds.has(w.id) ? (
                      <span className="text-xs text-[var(--usha-gold)]">{t("voted")}</span>
                    ) : (
                      <form action={voteDjWish}>
                        <input type="hidden" name="wishId" value={w.id} />
                        <input type="hidden" name="back" value={backPath} />
                        <button className="rounded-lg border border-[var(--usha-gold)]/50 px-2.5 py-1 text-xs font-semibold text-[var(--usha-gold)]">
                          {t("vote")}
                        </button>
                      </form>
                    )
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--usha-border)]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)]"
                  style={{ width: `${Math.min(100, Math.round((w.votes / DJ_WISH_GOAL) * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {viewerId ? (
        <form action={addDjWish} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="listingId" value={listingId} />
          <input type="hidden" name="back" value={backPath} />
          <input name="name" required minLength={2} maxLength={80} placeholder={t("namePlaceholder")} className={`${input} flex-1`} />
          <input name="link" type="url" maxLength={300} placeholder={t("linkPlaceholder")} className={`${input} flex-1`} />
          <button className="rounded-lg bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-4 py-2 text-sm font-bold text-black">
            {t("add")}
          </button>
        </form>
      ) : (
        <Link href={`/login?next=${encodeURIComponent(backPath + "#dj")}`} className="mt-4 inline-block text-sm font-semibold text-[var(--usha-gold)]">
          {t("loginToVote")}
        </Link>
      )}
    </section>
  );
}
