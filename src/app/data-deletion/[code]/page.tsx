import { createClient as createAdminClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

import { privatePage } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";
export const metadata = { title: "Radering av data — Usha Platform", ...privatePage() };

export default async function DataDeletionStatusPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: request } = await supabase
    .from("data_deletion_requests")
    .select("provider, received_at")
    .eq("confirmation_code", code)
    .maybeSingle();

  if (!request) notFound();

  const receivedDate = new Date(request.received_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const providerLabel = request.provider === "facebook" ? "Facebook" : request.provider;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold">Data Deletion Request</h1>
      <p className="mt-4 text-[var(--usha-muted)]">
        We received your request to delete the data associated with your {providerLabel}{" "}
        account on {receivedDate}.
      </p>
      <p className="mt-4 text-[var(--usha-muted)]">
        Confirmation code: <code className="rounded bg-[var(--usha-card)] px-2 py-1">{code}</code>
      </p>
      <p className="mt-4 text-[var(--usha-muted)]">
        All {providerLabel} access tokens and Page references linked to this account have been
        removed from our database. If you have other data on Usha Platform (such as a profile, events,
        or bookings), you can delete those separately under{" "}
        <a href="/app/profile" className="text-[var(--usha-gold)] underline">
          your account settings
        </a>{" "}
        or contact us at{" "}
        <a href="mailto:privacy@usha.se" className="text-[var(--usha-gold)] underline">
          privacy@usha.se
        </a>
        .
      </p>
      <p className="mt-8 text-xs text-[var(--usha-muted)]">
        See our{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>{" "}
        for more information about how we handle your data.
      </p>
    </main>
  );
}
