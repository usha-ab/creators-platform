"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authUrlWithNext } from "@/lib/auth/next-path";
import { useTranslations } from "next-intl";
import { UserPlus, UserCheck, Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

interface FollowButtonProps {
  creatorId: string;
  initialFollowing: boolean;
  followerCount: number;
  isLoggedIn: boolean;
  /** Vart signup-flödet ska återvända. Standard: kreatörens profil. */
  returnTo?: string;
  size?: "sm" | "md";
}

export function FollowButton({
  creatorId,
  initialFollowing,
  followerCount,
  isLoggedIn,
  returnTo,
  size = "md",
}: FollowButtonProps) {
  const t = useTranslations("creatorProfile");
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(followerCount);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleToggle() {
    if (!isLoggedIn) {
      // Den som skannar en lokals QR-kod har oftast inget konto. Signup är rätt
      // dörr, och login-länken där bär med vägen tillbaka.
      router.push(authUrlWithNext("/signup", returnTo ?? `/creators/${creatorId}`));
      return;
    }

    setLoading(true);
    // Optimistic update
    setFollowing(!following);
    setCount(following ? count - 1 : count + 1);

    try {
      const res = await fetch("/api/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId }),
      });

      if (!res.ok) {
        // Revert
        setFollowing(following);
        setCount(count);
      } else if (!following) {
        // Bara när någon börjar följa. Att sluta följa är också information,
        // men det hör hemma i databasen, inte som en "konvertering".
        trackEvent(ANALYTICS_EVENTS.follow, { creator: creatorId, method: "account" });
      }
    } catch {
      setFollowing(following);
      setCount(count);
    }
    setLoading(false);
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 rounded-xl font-medium transition ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"} ${
        following
          ? "border border-[var(--usha-gold)]/30 text-[var(--usha-gold)] hover:border-red-500/30 hover:text-red-400"
          : "bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] text-black hover:opacity-90"
      } disabled:opacity-60`}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : following ? (
        <UserCheck size={14} />
      ) : (
        <UserPlus size={14} />
      )}
      {following ? t("followButton.following") : t("followButton.follow")}
      {count > 0 && (
        <span className={`text-xs ${following ? "text-[var(--usha-muted)]" : "text-black/60"}`}>
          · {count}
        </span>
      )}
    </button>
  );
}
