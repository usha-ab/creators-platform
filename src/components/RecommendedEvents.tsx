'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Sparkles, Lock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MatchingOnboardingModal } from '@/components/matching/onboarding-modal';

interface Recommendation {
  id: string;
  title: string;
  price: number;
  image_url: string | null;
  creator: { id: string; name: string | null; avatar: string | null };
  category: string;
  eventTier: string;
  bookingCount: number;
  match_reasons?: string[];
}

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'locked'; count: number }
  | { kind: 'content'; items: Recommendation[]; launch: boolean };

function sek(amount: number): string {
  return amount.toLocaleString('sv-SE');
}

const CATEGORY_COLORS: Record<string, string> = {
  dance: 'bg-pink-500/10 text-pink-400',
  music: 'bg-blue-500/10 text-blue-400',
  photo: 'bg-amber-500/10 text-amber-400',
  yoga: 'bg-green-500/10 text-green-400',
  food: 'bg-orange-500/10 text-orange-400',
};

interface Prefs { dance_styles?: string[]; skill_level?: string | null; city?: string | null }

export default function RecommendedEvents() {
  const t = useTranslations('recommendations');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch('/api/preferences');
      if (res.ok) { const d = await res.json(); setPrefs(d.preferences ?? null); }
    } catch { /* non-fatal */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/recommendations?role=user&limit=6');
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data?.error === 'premium_required') {
          setState({ kind: 'locked', count: Number(data.count) || 0 });
          return;
        }
        setState({ kind: 'error' });
        return;
      }
      if (!res.ok) {
        // 401 (signed out) or other — hide the surface rather than erroring loudly.
        setState({ kind: 'content', items: [], launch: false });
        return;
      }
      const data = await res.json();
      setState({ kind: 'content', items: data.recommendations ?? [], launch: !!data.launch });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => { load(); loadPrefs(); }, [load, loadPrefs]);

  if (state.kind === 'loading') return <RecommendedSkeleton />;

  if (state.kind === 'error') {
    return (
      <Section>
        <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 text-center">
          <p className="text-sm text-[var(--usha-muted)]">{t('loadError')}</p>
        </div>
      </Section>
    );
  }

  // Premium gate active and the user is not Premium: count-only teaser.
  if (state.kind === 'locked') {
    return (
      <Section badge={t('launchBadge')}>
        <div className="relative overflow-hidden rounded-2xl border border-[var(--usha-gold)]/30 bg-[var(--usha-card)]">
          <div className="grid grid-cols-2 gap-3 p-4 blur-sm select-none sm:grid-cols-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-[var(--usha-border)]" />
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--usha-black)]/40 p-6 text-center">
            <Lock size={22} className="text-[var(--usha-gold)]" />
            <p className="text-sm font-semibold text-[var(--usha-white)]">
              {t('lockedTitle', { count: state.count })}
            </p>
            <Link
              href="/dashboard/billing"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
            >
              {t('upgrade')} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </Section>
    );
  }

  // Content (open mode, or Premium user in premium mode)
  const { items, launch } = state;

  return (
    <Section badge={launch ? t('launchBadge') : undefined}>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-6 text-center">
          <Sparkles size={22} className="mx-auto mb-3 text-[var(--usha-gold)]" />
          <p className="mb-1 text-sm font-semibold text-[var(--usha-white)]">{t('emptyTitle')}</p>
          <p className="mb-4 text-sm text-[var(--usha-muted)]">{t('emptyBody')}</p>
          <button
            onClick={() => setOnboardOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
          >
            {t('emptyCta')}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <button
              onClick={() => setOnboardOpen(true)}
              className="text-xs text-[var(--usha-muted)] underline-offset-2 transition hover:text-[var(--usha-white)] hover:underline"
            >
              {t('editPrefs')}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((rec) => (
              <EventCard key={rec.id} event={rec} />
            ))}
          </div>
        </>
      )}

      <MatchingOnboardingModal
        open={onboardOpen}
        onClose={() => setOnboardOpen(false)}
        onSaved={() => { load(); loadPrefs(); }}
        initial={prefs}
      />
    </Section>
  );
}

function Section({ children, badge }: { children: React.ReactNode; badge?: string }) {
  const t = useTranslations('recommendations');
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-[var(--usha-white)]">{t('forYou')}</h2>
        {badge && (
          <span className="rounded-full border border-[var(--usha-gold)]/30 bg-[var(--usha-gold)]/10 px-2.5 py-0.5 text-[10px] font-medium text-[var(--usha-gold)]">
            {badge}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function EventCard({ event }: { event: Recommendation }) {
  const t = useTranslations('recommendations');
  const categoryStyle =
    CATEGORY_COLORS[event.category] ?? 'bg-[var(--usha-gold)]/10 text-[var(--usha-gold)]';

  return (
    <div className="group rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] overflow-hidden hover:border-[var(--usha-gold)]/30 transition-colors">
      <div className="relative h-36 overflow-hidden bg-gradient-to-br from-[var(--usha-card-hover)] to-[var(--usha-border)]">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt={event.title}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-10 h-10 text-[var(--usha-muted)]/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {event.eventTier && (
          <span className="absolute top-2 right-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-black/50 text-[var(--usha-gold)]">
            {t('tier', { tier: event.eventTier.toUpperCase() })}
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className={cn('text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full', categoryStyle)}>
            {event.category}
          </span>
          {event.bookingCount > 0 && (
            <span className="text-[10px] text-[var(--usha-muted)]">
              {t('bookings', { count: event.bookingCount })}
            </span>
          )}
        </div>

        <h3 className="text-sm font-semibold text-[var(--usha-white)] line-clamp-2 leading-tight">
          {event.title}
        </h3>

        {/* Match reasons — transparency builds trust */}
        {event.match_reasons && event.match_reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {event.match_reasons.map((r) => (
              <span key={r} className="rounded-full bg-[var(--usha-gold)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--usha-gold)]">
                {r}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {event.creator?.avatar ? (
            <img src={event.creator.avatar} alt={event.creator.name ?? t('creatorAlt')} className="w-5 h-5 rounded-full object-cover" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-[var(--usha-border)] flex items-center justify-center">
              <span className="text-[9px] font-bold text-[var(--usha-muted)]">
                {(event.creator?.name ?? '?')[0]?.toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-xs text-[var(--usha-muted)] truncate">
            {event.creator?.name ?? t('unknownCreator')}
          </span>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-base font-bold text-[var(--usha-white)]">
            {sek(event.price)} <span className="text-xs text-[var(--usha-muted)] font-normal">SEK</span>
          </span>
          <Button
            size="sm"
            className="bg-[var(--usha-gold)] hover:bg-[var(--usha-gold-light)] text-black text-xs font-semibold px-4"
            onClick={() => {
              // Go to the listing detail (resolves by id or slug) — the creator
              // profile route 404s for non-public creators and drops the listing.
              window.location.href = `/listing/${event.id}`;
            }}
          >
            {t('bookNow')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RecommendedSkeleton() {
  return (
    <section className="space-y-4">
      <div className="h-6 w-48 bg-[var(--usha-card)] rounded animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] overflow-hidden animate-pulse">
            <div className="h-36 bg-[var(--usha-card-hover)]" />
            <div className="p-4 space-y-3">
              <div className="h-3 w-16 bg-[var(--usha-border)] rounded" />
              <div className="h-4 w-3/4 bg-[var(--usha-border)] rounded" />
              <div className="h-3 w-24 bg-[var(--usha-border)] rounded" />
              <div className="flex justify-between">
                <div className="h-5 w-16 bg-[var(--usha-border)] rounded" />
                <div className="h-8 w-20 bg-[var(--usha-border)] rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
