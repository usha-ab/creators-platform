import { notIndexable } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offline — Usha Platform", ...notIndexable() };

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--usha-gold)] to-[var(--usha-accent)]">
        <span className="text-2xl font-bold text-black">U</span>
      </div>
      <h1 className="mb-3 text-2xl font-bold">Du är offline</h1>
      <p className="max-w-sm text-sm text-[var(--usha-muted)]">
        Det verkar som att du inte har internetanslutning just nu. Kontrollera
        din anslutning och försök igen.
      </p>
      <a
        href="/"
        className="mt-8 inline-block rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-3 text-sm font-bold text-black transition hover:opacity-90"
      >
        Försök igen
      </a>
    </div>
  );
}
