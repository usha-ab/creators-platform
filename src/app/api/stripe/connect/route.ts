import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/client';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTranslations } from 'next-intl/server';
import { decideConnectAccount, type ConnectProfile } from '@/lib/payments/connect-eligibility';

/**
 * POST /api/stripe/connect
 * Creates a Stripe Connect Express account for the authenticated creator
 * and returns the onboarding URL.
 *
 * Spärrar (lib/payments/connect-eligibility.ts): BankID-verifierad säljare,
 * verifierad bolagsform, svenskt org-nr, F-skatt för enskild firma, inga
 * utländska konton. business_type följer bolagsformen.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Läses via service-role: stripe_account_id, BankID- och bolagsfälten är
    // kolumn-låsta för authenticated. Uppslaget sker på den inloggades eget id.
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, bankid_verified_at, bankid_grandfathered_at, stripe_account_id, email, full_name, company_form, org_number, f_tax_verified_at')
      .eq('id', user.id)
      .maybeSingle();

    const decision = decideConnectAccount(profile as ConnectProfile | null);
    if (!decision.ok) {
      const t = await getTranslations('payeeGate');
      return NextResponse.json(
        { error: t(`connect_${decision.code}`), code: decision.code },
        { status: 403 }
      );
    }

    if (profile?.stripe_account_id) {
      // Account exists — request card_payments (needed for on_behalf_of / merchant
      // of record) so the re-onboarding link collects the extra KYC, then send the
      // organizer through onboarding again.
      await stripe.accounts.update(profile.stripe_account_id, {
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
      });
      const accountLink = await stripe.accountLinks.create({
        account: profile.stripe_account_id,
        refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?connect=refresh`,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?connect=success`,
        type: 'account_onboarding',
      });

      return NextResponse.json({ url: accountLink.url });
    }

    if (decision.existing) {
      // Kan inte hända: ett befintligt konto hanteras ovan.
      return NextResponse.json({ error: 'Unexpected state' }, { status: 500 });
    }

    // Nytt Express-konto, alltid svenskt (utländska spärras ovan), med
    // business_type efter den verifierade bolagsformen.
    const account = await stripe.accounts.create({
      type: 'express',
      country: decision.country,
      email: user.email,
      business_type: decision.businessType,
      capabilities: {
        transfers: { requested: true },
        // card_payments is required to make the organizer merchant of record
        // (on_behalf_of) for third-party ticket sales.
        card_payments: { requested: true },
      },
      metadata: {
        userId: user.id,
        companyForm: profile?.company_form ?? '',
      },
    });

    // Save the account ID to the profile
    const { error: updateError } = await admin
      .from('profiles')
      .update({ stripe_account_id: account.id })
      .eq('id', user.id);

    if (updateError) {
      console.error('Failed to save Stripe account ID:', updateError);
      return NextResponse.json(
        { error: 'Could not save account information' },
        { status: 500 }
      );
    }

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?connect=refresh`,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?connect=success`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error) {
    console.error('Stripe Connect error:', error);
    return NextResponse.json(
      { error: "An error occurred. Please try again." },
      { status: 500 }
    );
  }
}
