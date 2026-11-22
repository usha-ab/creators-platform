import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/client';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTranslations } from 'next-intl/server';
import { decideConnectAccount, type ConnectProfile } from '@/lib/payments/connect-eligibility';

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if creator already has a Stripe Connect account
    const adminSupabase = createAdminClient();
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('id, stripe_account_id, full_name, email, role, bankid_verified_at, bankid_grandfathered_at, company_form, org_number, f_tax_verified_at')
      .eq('id', user.id)
      .single();

    // Samma spärrar som /api/stripe/connect (BankID-säljare, bolagsform,
    // F-skatt för enskild firma, inga utländska konton), så att den här äldre
    // vägen inte blir en väg förbi.
    const decision = decideConnectAccount(profile as ConnectProfile | null);
    if (!decision.ok) {
      const t = await getTranslations('payeeGate');
      return NextResponse.json({ error: t(`connect_${decision.code}`), code: decision.code }, { status: 403 });
    }

    let accountId = profile?.stripe_account_id;

    if (!accountId) {
      // Create a new Stripe Connect Express account
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'SE',
        email: profile?.email || user.email,
        ...(!decision.existing ? { business_type: decision.businessType } : {}),
        capabilities: {
          transfers: { requested: true },
          // card_payments enables on_behalf_of (organizer as merchant of record).
          card_payments: { requested: true },
        },
        business_profile: {
          name: profile?.full_name || undefined,
        },
      });

      accountId = account.id;

      // Save to profile
      await adminSupabase
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);
    } else {
      // Existing account — ensure card_payments is requested so re-onboarding
      // collects the KYC needed for the merchant-of-record shift.
      await stripe.accounts.update(accountId, {
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
      });
    }

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?connect=refresh`,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?connect=success`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error) {
    console.error('Connect onboarding error:', error);
    return NextResponse.json(
      { error: 'Kunde inte starta Stripe Connect onboarding' },
      { status: 500 }
    );
  }
}
