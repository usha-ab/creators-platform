import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function SlugPage({ params }: Props) {
  const { slug } = await params;

  // Only allow valid slug characters (letters, numbers, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("slug", slug.toLowerCase())
    .eq("is_public", true)
    .single();

  if (!profile) {
    notFound();
  }

  // Till slug-adressen, inte till id:t. /creators/[id] slår upp båda, och den
  // som skrivit in usha.se/osvaldopalma ska inte hamna på en 36 tecken lång
  // UUID i adressfältet — hela poängen med en egen adress är att den går att
  // säga, dela och känna igen.
  redirect(`/creators/${slug.toLowerCase()}`);
}
