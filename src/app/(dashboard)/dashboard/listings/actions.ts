"use server";

import { createClient } from "@/lib/supabase/server";
import { requiresTaxiDancer } from "@/lib/listings/package-access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePaidSubscription, getSubscriptionStatus } from "@/lib/subscription/check";
import { checkListingLimit } from "@/lib/listings/limits";
import { generateUniqueListingSlug } from "@/lib/listings/slug";

const CATEGORIES = ["dance", "music", "photo", "video", "design", "yoga", "fitness", "other"] as const;
const VALID_LISTING_TYPES = [
  "service",
  "event",
  "table_reservation",
  "spa_treatment",
  "group_activity",
  "package",
  "coaching_session",
  "b2b_offering",
] as const;
type ListingType = (typeof VALID_LISTING_TYPES)[number];

function parseListingForm(formData: FormData) {
  const title = (formData.get("title") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const category = formData.get("category") as string;
  const priceRaw = formData.get("price") as string;
  const durationRaw = formData.get("duration_minutes") as string;
  const imageUrl = (formData.get("image_url") as string)?.trim() || null;
  const eventDate = (formData.get("event_date") as string)?.trim() || null;
  const eventTime = (formData.get("event_time") as string)?.trim() || null;
  const eventLocation = (formData.get("event_location") as string)?.trim() || null;
  const eventEndTime = (formData.get("event_end_time") as string)?.trim() || null;
  const eventLatRaw = formData.get("event_lat") as string;
  const eventLngRaw = formData.get("event_lng") as string;
  const eventPlaceId = (formData.get("event_place_id") as string)?.trim() || null;
  // PlacesAutocomplete skickar med stad och lokalnamn, men de lästes aldrig
  // här — så allt som skapades från dashboarden saknade event_city och föll
  // ur stadsfiltret, sidfoten och "Upplevelser i Stockholm".
  const eventCity = (formData.get("event_city") as string)?.trim() || null;
  const eventVenue = (formData.get("event_venue") as string)?.trim() || null;
  const eventLat = eventLatRaw ? parseFloat(eventLatRaw) : null;
  const eventLng = eventLngRaw ? parseFloat(eventLngRaw) : null;
  const listingTypeRaw = (formData.get("listing_type") as string)?.trim();
  const listing_type: ListingType = VALID_LISTING_TYPES.includes(listingTypeRaw as ListingType)
    ? (listingTypeRaw as ListingType)
    : "service";
  const sessionCountRaw = formData.get("session_count") as string;
  const sessionCountParsed = sessionCountRaw ? parseInt(sessionCountRaw, 10) : null;
  const session_count =
    listing_type === "package" &&
    sessionCountParsed !== null &&
    Number.isFinite(sessionCountParsed) &&
    sessionCountParsed > 0
      ? sessionCountParsed
      : null;

  // Klippkort kopplat till en eller flera serier: kortet blir en biljett som
  // skannas i dörren på varje seriens kvällar. Ägarskapet av serierna prövas i
  // create/update (kräver databas). pass_series_id speglar första serien så en
  // äldre utrullning som läser kolumnen ser rätt.
  const pass_series_ids =
    listing_type === "package"
      ? [...new Set(
          formData
            .getAll("pass_series_id")
            .map((v) => String(v).trim())
            .filter((v) => /^[0-9a-f-]{36}$/i.test(v))
        )]
      : [];
  const pass_series_id = pass_series_ids[0] ?? null;
  const pass_covers =
    listing_type === "package" ? ((formData.get("pass_covers") as string)?.trim().slice(0, 80) || null) : null;
  // Jämförpriset rabatten räknas mot. Tomt = systemet jämför mot biljettypen
  // som heter samma sak som pass_covers.
  const referenceRaw = listing_type === "package" ? (formData.get("pass_reference_price") as string)?.trim() : "";
  const referenceParsed = referenceRaw ? parseInt(referenceRaw, 10) : NaN;
  const pass_reference_price =
    Number.isFinite(referenceParsed) && referenceParsed > 0 ? referenceParsed : null;

  if (!title) return { error: "Titel krävs" } as const;
  if (!category || !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return { error: "Välj en giltig kategori" } as const;
  }

  const price = priceRaw ? parseInt(priceRaw, 10) : null;
  const duration_minutes = durationRaw ? parseInt(durationRaw, 10) : null;

  if (price !== null && (isNaN(price) || price < 0)) {
    return { error: "Priset måste vara 0 eller högre" } as const;
  }
  if (duration_minutes !== null && (isNaN(duration_minutes) || duration_minutes <= 0)) {
    return { error: "Längden måste vara ett positivt tal" } as const;
  }
  if (listing_type === "package" && session_count === null) {
    return { error: "Antal pass måste anges för ett klippkort" } as const;
  }

  return {
    data: {
      title,
      description: description || null,
      category,
      price,
      duration_minutes,
      image_url: imageUrl,
      event_date: eventDate,
      event_time: eventTime,
      event_end_time: eventEndTime,
      event_location: eventLocation,
      event_lat: eventLat,
      event_lng: eventLng,
      event_place_id: eventPlaceId,
      event_city: eventCity,
      event_venue: eventVenue,
      listing_type,
      session_count,
      pass_series_id,
      pass_series_ids: pass_series_ids.length > 0 ? pass_series_ids : null,
      pass_covers,
      pass_reference_price,
    },
  } as const;
}

export async function createListing(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  // Require paid subscription to create listings
  try {
    await requirePaidSubscription();
  } catch {
    return { error: "Du behöver en Guld- eller Premium-prenumeration för att skapa tjänster." };
  }

  // Check listing limit for user's tier
  const { tier } = await getSubscriptionStatus(user.id);
  const limit = await checkListingLimit(user.id, tier);
  if (!limit.allowed) {
    return { error: `Du har nått maxgränsen (${limit.max}) för din plan. Uppgradera för att skapa fler.` };
  }

  const parsed = parseListingForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  // Coaching och B2B är taxidansarnas egna typer och förblir låsta.
  // KLIPPKORT (package) är det inte: en boxningstränare säljer 5- och
  // 10-passkort på precis samma sätt som en taxidansare säljer danser, och
  // plattformen är inte en dansplattform. Låsningen var arvet från när
  // funktionen hette danspaket.
  // Förfalskningsförsök faller tillbaka på 'service'.
  let resolvedListingType: ListingType = parsed.data.listing_type;
  if (requiresTaxiDancer(resolvedListingType)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("creator_subcategory")
      .eq("id", user.id)
      .single();
    if ((profile as { creator_subcategory?: string | null } | null)?.creator_subcategory !== "taxi_dancer") {
      resolvedListingType = "service";
    }
  }

  if (!(await ownsEverySeries(supabase, user.id, parsed.data.pass_series_ids))) {
    return { error: "Serien hittades inte bland dina evenemang." };
  }

  const { data: listing, error } = await supabase
    .from("listings")
    .insert({ ...parsed.data, listing_type: resolvedListingType, user_id: user.id })
    .select("id, title, price, image_url")
    .single();

  if (error || !listing) return { error: "Kunde inte skapa tjänsten. Försök igen." };

  // Auto-post to feed
  const priceText = parsed.data.price ? ` — ${parsed.data.price} kr` : "";
  await supabase.from("posts").insert({
    user_id: user.id,
    text: `Ny tjänst: ${parsed.data.title}${priceText}. Boka direkt via min profil!`,
    image_url: parsed.data.image_url,
    listing_id: listing.id,
  });

  revalidatePath("/dashboard/listings");
  revalidatePath("/dashboard");
  revalidatePath("/app");
  revalidatePath("/app/posts");
  redirect("/dashboard/listings");
}

export async function updateListing(id: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  try {
    await requirePaidSubscription();
  } catch {
    return { error: "Du behöver en Guld- eller Premium-prenumeration för att redigera tjänster." };
  }

  const parsed = parseListingForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  // Samma grind som i createListing: klippkort är öppet för alla kreatörer,
  // coaching och B2B är fortsatt taxidansarnas.
  let resolvedListingType: ListingType = parsed.data.listing_type;
  if (requiresTaxiDancer(resolvedListingType)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("creator_subcategory")
      .eq("id", user.id)
      .single();
    if ((profile as { creator_subcategory?: string | null } | null)?.creator_subcategory !== "taxi_dancer") {
      resolvedListingType = "service";
    }
  }

  if (!(await ownsEverySeries(supabase, user.id, parsed.data.pass_series_ids))) {
    return { error: "Serien hittades inte bland dina evenemang." };
  }

  const { error } = await supabase
    .from("listings")
    .update({ ...parsed.data, listing_type: resolvedListingType })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { error: "Kunde inte uppdatera tjänsten. Försök igen." };

  revalidatePath("/dashboard/listings");
  revalidatePath("/dashboard");
  redirect("/dashboard/listings");
}

export async function deleteListing(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  const { error } = await supabase
    .from("listings")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { error: "Kunde inte ta bort tjänsten." };

  revalidatePath("/dashboard/listings");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function toggleListingActive(id: string, isActive: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  const { error } = await supabase
    .from("listings")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { error: "Kunde inte ändra status." };

  revalidatePath("/dashboard/listings");
  return { success: true };
}

/**
 * Duplicate a listing as an inactive draft. Keeps series_id/series_slug, so
 * duplicating a series occurrence adds another occurrence to the same series
 * (the new copy starts as a draft for the owner to set a new date). Same gating
 * as creating a listing.
 */
export async function duplicateListing(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Ej inloggad" };

  try {
    await requirePaidSubscription();
  } catch {
    return { error: "Du behöver en Guld- eller Premium-prenumeration för att skapa tjänster." };
  }

  const { tier } = await getSubscriptionStatus(user.id);
  const limit = await checkListingLimit(user.id, tier);
  if (!limit.allowed) {
    return { error: `Du har nått maxgränsen (${limit.max}) för din plan. Uppgradera för att skapa fler.` };
  }

  const { data: src } = await supabase
    .from("listings")
    .select(
      "title, description, category, price, duration_minutes, event_tier, image_url, event_date, event_time, event_end_time, event_location, event_lat, event_lng, event_place_id, event_city, event_venue, listing_type, capacity, min_guests, max_guests, experience_details, series_id, series_slug, open_to_instructors, session_count"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!src) return { error: "Tjänsten hittades inte." };

  // Always give the copy its own slug — never inherit null. A null slug breaks
  // /event/<series-slug> resolution for occurrences. The owner sets a new date
  // afterward; updateEvent() then re-slugs the occurrence to match that date.
  const slug = await generateUniqueListingSlug(supabase, src.title, {
    dateSuffix: src.event_date ?? undefined,
  });

  const { data: copy, error } = await supabase
    .from("listings")
    .insert({ ...src, user_id: user.id, is_active: false, slug })
    .select("id")
    .single();
  if (error || !copy) return { error: "Kunde inte duplicera tjänsten." };

  revalidatePath("/dashboard/listings");
  revalidatePath("/dashboard");
  return { success: true, id: copy.id };
}

/** Varje serie kortet gäller måste vara ens egen; tomt är inget kort på serie. */
async function ownsEverySeries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  seriesIds: string[] | null | undefined
): Promise<boolean> {
  for (const id of seriesIds ?? []) {
    if (!(await ownsSeries(supabase, userId, id))) return false;
  }
  return true;
}

/** Får bara koppla kortet till en serie man själv arrangerar. */
async function ownsSeries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  seriesId: string
): Promise<boolean> {
  const { count } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId)
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

/**
 * Flytta en tjänst upp eller ner i kreatörens egen ordning.
 *
 * Ordningen är gles och normaliseras vid varje flytt: raderna numreras om
 * 0,1,2,… innan bytet. Det gör funktionen tålig mot rader som saknar ordning
 * (allt som fanns före kolumnen), mot dubbletter, och mot att två flyttar sker
 * tätt inpå varandra — utfallet blir detsamma oavsett vilket skick listan var
 * i när man började.
 *
 * Bara tjänster ordnas. Evenemang har datum, och ett datum är en bättre
 * ordning än en handpåläggning.
 */
export async function moveListing(id: string, riktning: "upp" | "ner") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Ej inloggad" } as const;

  const { data: rader } = await supabase
    .from("listings")
    .select("id, sort_order, created_at, event_date")
    .eq("user_id", user.id)
    .is("event_date", null)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  const lista = rader ?? [];
  const i = lista.findIndex((l) => l.id === id);
  if (i < 0) return { error: "Hittar inte tjänsten" } as const;

  const j = riktning === "upp" ? i - 1 : i + 1;
  if (j < 0 || j >= lista.length) return { ok: true } as const; // redan ytterst

  const omordnad = [...lista];
  [omordnad[i], omordnad[j]] = [omordnad[j], omordnad[i]];

  // Skriv bara de rader vars nummer faktiskt ändras.
  const uppdateringar = omordnad
    .map((l, n) => ({ id: l.id, sort_order: n, gammalt: l.sort_order }))
    .filter((u) => u.sort_order !== u.gammalt);

  for (const u of uppdateringar) {
    const { error } = await supabase
      .from("listings")
      .update({ sort_order: u.sort_order })
      .eq("id", u.id)
      .eq("user_id", user.id);
    if (error) return { error: "Kunde inte spara ordningen. Försök igen." } as const;
  }

  revalidatePath("/dashboard/listings");
  revalidatePath("/creators", "layout");
  return { ok: true } as const;
}

/**
 * Spara en hel ordning på en gång — det drag-och-släpp ger.
 *
 * Tar emot id:n i den ordning de ska ligga och numrerar om dem 0,1,2,…
 * Ägarskapet prövas per rad (.eq("user_id", user.id)), så en påhittad lista med
 * någon annans id ändrar ingenting hos dem.
 *
 * Skriver bara de rader vars nummer faktiskt ändras. Ett drag flyttar oftast
 * några få steg, och då är det onödigt att röra hela listan.
 */
export async function reorderListings(orderedIds: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Ej inloggad" } as const;

  const { data: nuvarande } = await supabase
    .from("listings")
    .select("id, sort_order")
    .eq("user_id", user.id)
    .in("id", orderedIds);

  const gammal = new Map((nuvarande ?? []).map((l) => [l.id, l.sort_order]));

  for (let i = 0; i < orderedIds.length; i++) {
    if (gammal.get(orderedIds[i]) === i) continue;
    const { error } = await supabase
      .from("listings")
      .update({ sort_order: i })
      .eq("id", orderedIds[i])
      .eq("user_id", user.id);
    if (error) return { error: "Kunde inte spara ordningen. Försök igen." } as const;
  }

  revalidatePath("/dashboard/listings");
  revalidatePath("/creators", "layout");
  return { ok: true } as const;
}
