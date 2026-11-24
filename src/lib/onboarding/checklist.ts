// Category-aware onboarding checklist (REAL profile state).
//
// NOTE: this is intentionally separate from the §9-legal-gated mock router in
// `router.ts` / `guards.ts` (which drives the theoretical ob_* flow). This module
// only computes which practical setup steps a user still needs, per category,
// from their real profile — and links to the existing dashboard pages/gates.
//
// Pure + dependency-light so it is cheap to unit-test.
import { normalizeRole, ROLES } from "@/lib/roles";

export interface OnboardingContext {
  role: string | null | undefined;
  isCompany?: boolean;
  // seller profile state
  bio?: string | null;
  avatarUrl?: string | null;
  bankidVerifiedAt?: string | null;
  companyVerifiedAt?: string | null;
  termsUrl?: string | null;
  servicesCount?: number;
  /**
   * Bekräftade evenemang som ANDRA arrangerar hos lokalen.
   *
   * En lokal som upplåter sina lokaler skapar aldrig egna evenemang, och skulle
   * annars få "skapa ditt första evenemang" liggande kvar för alltid. En
   * checklista som aldrig kan bli klar är en checklista man slutar läsa.
   */
  hostedEventsCount?: number;
  stripeAccountId?: string | null;
  stripeCardPaymentsEnabled?: boolean;
  isPublic?: boolean;
  // customer state
  customerLocation?: string | null;
  hasPreferences?: boolean;
}

export interface OnboardingStep {
  key: string;
  /** i18n key under the "onboarding" namespace. */
  labelKey: string;
  done: boolean;
  href: string;
  required: boolean;
}

const PROFILE = "/dashboard/profile";
const BILLING = "/dashboard/billing";
// Getting paid is set up on the Payouts page. Sending someone to the
// subscription page for a payouts task is how a finishable step comes to look
// impossible — they arrive somewhere about plans and see nothing to do.
const PAYOUTS = "/dashboard/payouts";

/** Steps for a seller's Stripe connection, reflecting the two-flow MoR model. */
function stripeStep(ctx: OnboardingContext): OnboardingStep {
  if (!ctx.stripeAccountId) {
    return { key: "stripe", labelKey: "connectStripe", done: false, href: PAYOUTS, required: true };
  }
  if (!ctx.stripeCardPaymentsEnabled) {
    // Connected but not yet merchant-of-record capable — must finish onboarding.
    return { key: "stripe", labelKey: "completeStripe", done: false, href: PAYOUTS, required: true };
  }
  return { key: "stripe", labelKey: "connectStripe", done: true, href: PAYOUTS, required: true };
}

/**
 * Build the ordered onboarding steps for a user's category. Company steps appear
 * for venues and for creators-with-company; the customer flow is light.
 */
export function buildOnboardingSteps(ctx: OnboardingContext): OnboardingStep[] {
  const role = normalizeRole(ctx.role);
  const services = ctx.servicesCount ?? 0;

  // ── Customer: light flow, no seller/payment gates ──
  if (role === ROLES.CUSTOMER || role === null) {
    return [
      {
        key: "customer_profile",
        labelKey: "customerCompleteProfile",
        done: !!ctx.customerLocation,
        href: PROFILE,
        required: true,
      },
      {
        key: "customer_preferences",
        labelKey: "customerSetPreferences",
        done: !!ctx.hasPreferences,
        href: "/app",
        required: false,
      },
    ];
  }

  const isVenue = role === ROLES.VENUE;
  const isCompany = isVenue || !!ctx.isCompany;
  const steps: OnboardingStep[] = [];

  // Profile (bio + avatar)
  steps.push({
    key: "profile",
    labelKey: "completeProfile",
    done: !!(ctx.bio && ctx.avatarUrl),
    href: PROFILE,
    required: true,
  });

  // BankID — required for creators. For venues it is not needed to approve other
  // organisers' events, but it IS required to create their own (events/actions.ts),
  // so the label says so instead of "optional".
  if (!isVenue) {
    steps.push({
      key: "bankid",
      labelKey: "verifyBankid",
      done: !!ctx.bankidVerifiedAt,
      href: PROFILE,
      required: true,
    });
  } else if (!ctx.companyVerifiedAt) {
    steps.push({
      key: "bankid",
      labelKey: "verifyBankidOptional",
      done: !!ctx.bankidVerifiedAt,
      href: PROFILE,
      required: false,
    });
  }

  // Company verification (venue + creator-with-company) → org.nr on receipts + MoR.
  if (isCompany) {
    steps.push({
      key: "company",
      labelKey: "verifyCompany",
      done: !!ctx.companyVerifiedAt,
      href: PROFILE,
      required: true,
    });
    // Purchase terms — recommended for companies (shown at checkout).
    steps.push({
      key: "terms",
      labelKey: "addTerms",
      done: !!ctx.termsUrl,
      href: PROFILE,
      required: false,
    });
  }

  // First listing/event. För en lokal räknas även bekräftade arrangemang som
  // andra håller där — att fylla huset är målet, inte att själv stå som
  // arrangör.
  steps.push({
    key: "listing",
    labelKey: isVenue ? "createFirstEvent" : "createFirstService",
    done: services > 0 || (isVenue && (ctx.hostedEventsCount ?? 0) > 0),
    href: isVenue ? "/app/events/new" : "/dashboard/listings/new",
    required: true,
  });

  // Stripe payout / merchant-of-record
  steps.push(stripeStep(ctx));

  // Make profile public
  steps.push({
    key: "public",
    labelKey: "makeProfilePublic",
    done: !!ctx.isPublic,
    href: PROFILE,
    required: true,
  });

  return steps;
}

/** Convenience: how many steps are done vs total (for a progress bar). */
export function onboardingProgress(steps: OnboardingStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}
