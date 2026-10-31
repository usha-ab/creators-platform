import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { markEmailProven } from "@/lib/auth/email-proven";
import { adoptGuestBookings } from "@/lib/bookings/adopt-guest";

/**
 * Löser in återställningslänken på servern i stället för i webbläsaren, så att
 * vi vet att den faktiskt användes: länken kom via mejl till adressen, och då
 * är adressen bevisad (isEmailProven). Sessionscookien skrivs här; sidan sparar
 * sedan det nya lösenordet med den.
 */
export async function POST(req: NextRequest) {
  let tokenHash = "";
  try {
    tokenHash = String((await req.json())?.token_hash ?? "");
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (!tokenHash) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  const user = data?.user;
  if (error || !user) return NextResponse.json({ error: "expired" }, { status: 400 });

  if (user.email) {
    const admin = createAdminClient();
    await markEmailProven(admin, user.id, user.email);
    await adoptGuestBookings(admin, user.id, user.email, { emailProven: true });
  }
  return NextResponse.json({ ok: true });
}
