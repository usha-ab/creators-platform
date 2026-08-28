import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canUseListen } from "@/lib/tts/access";
import { ListenApp } from "./listen-app";

export const dynamic = "force-dynamic";

export const metadata = { title: "Lyssna – Usha Platform" };

export default async function LyssnaPage() {
  // Uppläsaren är ett privat verktyg medan den bryts ut till en egen app: den
  // står inte i någon meny, och den som ändå hittar hit utan tillgång skickas
  // vidare i stället för att mötas av en halv sida.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await canUseListen(user.id))) redirect("/app");

  // Resten bor i webbläsaren: dokumenten synkas via /api/tts/documents och
  // uppläsningen sker i webbläsarens talsyntes.
  return <ListenApp />;
}
