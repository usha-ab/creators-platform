import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { indexable } from "@/lib/seo/metadata";

export const metadata = {
  ...indexable("/refund-policy"),
  title: "Återbetalningspolicy | Usha Platform",
  description: "Så fungerar avbokning och återbetalning på Usha Platform.",
};

export default async function RefundPolicyPage() {
  const t = await getTranslations("refundPolicy");
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--usha-muted)] transition-colors hover:text-[var(--usha-white)]"
      >
        <ArrowLeft size={14} />
        {t("back")}
      </Link>

      <h1 className="text-3xl font-bold">{t("heading")}</h1>
      <p className="mt-2 text-sm text-[var(--usha-muted)]">
        {t("lastUpdated")}
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-[var(--usha-muted)]">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-[var(--usha-white)]">{t("overviewTitle")}</h2>
          <p>{t("overviewBody")}</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-[var(--usha-white)]">{t("cancellationTitle")}</h2>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <strong className="text-[var(--usha-white)]">{t("cancellationPendingLabel")}</strong>{" "}
              {t("cancellationPendingBody")}
            </li>
            <li>
              <strong className="text-[var(--usha-white)]">{t("cancellationConfirmedLabel")}</strong>{" "}
              {t("cancellationConfirmedBody")}
            </li>
            <li>
              <strong className="text-[var(--usha-white)]">{t("cancellationCompletedLabel")}</strong>{" "}
              {t("cancellationCompletedBody1")}{" "}
              <a
                href="mailto:support@usha.se"
                className="text-[var(--usha-gold)] hover:underline"
              >
                support@usha.se
              </a>{" "}
              {t("cancellationCompletedBody2")}
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-[var(--usha-white)]">
            {t("danceTitle")}
          </h2>
          <p>
            {t("danceBody1")}{" "}
            <strong className="text-[var(--usha-white)]">{t("danceBodyStrong")}</strong>. {t("danceBody2")}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-[var(--usha-white)]">
            {t("b2bTitle")}
          </h2>
          <p>{t("b2bBody")}</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-[var(--usha-white)]">{t("timelineTitle")}</h2>
          <p>
            {t("timelineBody1")}{" "}
            <strong className="text-[var(--usha-white)]">{t("timelineBodyStrong")}</strong>{" "}
            {t("timelineBody2")}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-[var(--usha-white)]">{t("disputesTitle")}</h2>
          <p>
            {t("disputesBody1")}{" "}
            <a
              href="mailto:support@usha.se"
              className="text-[var(--usha-gold)] hover:underline"
            >
              support@usha.se
            </a>{" "}
            {t("disputesBody2")}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-[var(--usha-white)]">{t("platformFeeTitle")}</h2>
          <p>{t("platformFeeBody")}</p>
        </section>
      </div>
    </div>
  );
}
