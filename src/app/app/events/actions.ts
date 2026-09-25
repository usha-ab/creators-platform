"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageListing } from "@/lib/listings/manage-access";
import { venuesUserCanCreateFor } from "@/lib/venues/members";
import { resolvePools, ownCapacityFor, parsePoolNames } from "@/lib/tickets/pools";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EVENT_CATEGORIES } from "./constants";
import { getSubscriptionStatus } from "@/lib/subscription/check";
import { checkListingLimit } from "@/lib/listings/limits";
import { generateUniqueListingSlug, generateUniqueSeriesSlug } from "@/lib/listings/slug";
import { createNotification } from "@/lib/notifications/create";
import { isSeller, isCreatorRole } from "@/lib/roles";
import { ticketGateForNewEvent, ticketGateForListing } from "@/lib/capabilities/gate";
import { stockholmLocalToUtcISO } from "@/lib/time";

/** Tidsstyrd automatisering (Lucka 3) ur formuläret. Datetime-fält tolkas som
 *  svensk tid och lagras som UTC. Tomma fält → null (avstängt). */
function parseAutomation(formData: FormData) {
  const num = (k: string) => {
    const v = formData.get(k);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const lang = formData.get("content_language");
  return {
    early_bird_start: stockholmLocalToUtcISO(formData.get("early_bird_start") as string | null),
    early_bird_end: stockholmLocalToUtcISO(formData.get("early_bird_end") as string | null),
    early_bird_price: num("early_bird_price"),
    public_sale_at: stockholmLocalToUtcISO(formData.get("public_sale_at") as string | null),
    capacity: num("capacity"),
    content_language: lang === "sv" || lang === "en" ? lang : null,
  };
}

const BANKID_REQUIRED_MSG =
  "För att skapa evenemang krävs ett kreatörs- eller platskonto som är verifierat med BankID. Byt roll och/eller verifiera dig under Profil.";

/**
 * Gate for creating/duplicating/editing listings. Creating an event goes through
 * the service-role client (co-organizers never own the row), so this app-level
 * check — not RLS — is the real gate. Requires BOTH:
 *   1. a SELLER role (creator/venue) — a `customer`/audience account must never
 *      create commercial listings, and
 *   2. BankID clearance (verified or grandfathered).
 *
 * Note: the DB function `is_bankid_cleared()` returns TRUE for `role='customer'`,
 * so relying on it alone (as this helper used to) let any audience account create
 * and sell events without ever verifying identity. We therefore check the seller
 * role explicitly here and mirror it in the listings RLS policy for defence in depth.
 */
async function isBankidCleared(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<boolean> {
  // bankid_grandfathered_at är kolumn-låst för authenticated — läs via service-role.
  const { data } = await createAdminClient()
    .from("profiles")
    .select("role, bankid_verified_at, bankid_grandfathered_at")
    .eq("id", userId)
    .single();
  if (!data) return false;
  if (!isSeller(data.role)) return false;
  return (
    data.bankid_verified_at != null ||
    data.bankid_grandfathered_at != null
  );
}

/**
 * Expand a recurring event into its occurrence dates (YYYY-MM-DD), starting
 * from `start` and including it. Date math is done in UTC to avoid timezone
 * drift. `monthly` uses calendar months (overflow lands in the next month,
 * e.g. Jan 31 → Mar 3), which is acceptable for scheduling.
 */
function computeSeriesDates(start: string, interval: string, count: number): string[] {
  const [y, m, day] = start.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, day));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    if (interval === "monthly") d.setUTCMonth(base.getUTCMonth() + i);
    else d.setUTCDate(base.getUTCDate() + i * (interval === "biweekly" ? 14 : 7));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function parseEventForm(formData: FormData) {
  const title = (formData.get("title") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const category = formData.get("category") as string;
  const priceRaw = formData.get("price") as string;
  const durationRaw = formData.get("duration_minutes") as string;
  const eventTier = (formData.get("event_tier") as string) || null;
  const imageUrl = (formData.get("image_url") as string)?.trim() || null;
  const eventDate = (formData.get("event_date") as string)?.trim() || null;
  const eventTime = (formData.get("event_time") as string)?.trim() || null;
  const eventLocation = (formData.get("event_location") as string)?.trim() || null;
  const eventEndTime = (formData.get("event_end_time") as string)?.trim() || null;
  const eventLatRaw = formData.get("event_lat") as string;
  const eventLngRaw = formData.get("event_lng") as string;
  const eventPlaceId = (formData.get("event_place_id") as string)?.trim() || null;
  const eventCity = (formData.get("event_city") as string)?.trim() || null;
  const eventVenue = (formData.get("event_venue") as string)?.trim() || null;
  // Lokalen som profil, skilt från event_venue som bara är ett namn från Places.
  const venueProfileId = (formData.get("venue_profile_id") as string)?.trim() || null;
  const eventLat = eventLatRaw ? parseFloat(eventLatRaw) : null;
  const eventLng = eventLngRaw ? parseFloat(eventLngRaw) : null;
  const listingType = (formData.get("listing_type") as string) || "event";
  const openToInstructors = formData.get("open_to_instructors") === "on";
  const serviceFeeMode = formData.get("service_fee_mode") === "absorb" ? "absorb" : "buyer";
  const minGuestsRaw = formData.get("min_guests") as string;
  const maxGuestsRaw = formData.get("max_guests") as string;
  const amenitiesRaw = (formData.get("amenities") as string)?.trim() || "";
  const includedRaw = (formData.get("included") as string)?.trim() || "";

  if (!title) return { error: "Titel krävs" } as const;

  // Tid krävs när evenemanget har ett datum.
  //
  // Sluttiden var frivillig, och utan den gissar besökarens kalenderapp: Google
  // lägger på en timme, Apple gör posten punktformig. En kväll 17–23 hamnade
  // alltså som en timme i kalendern hos den som tryckte på datumet.
  //
  // Starttiden kommer med i samma villkor eftersom en sluttid utan starttid
  // inte betyder något.
  if (eventDate) {
    if (!eventTime) return { error: "Ange starttid för evenemanget" } as const;
    if (!eventEndTime) return { error: "Ange sluttid — annars vet inte besökarens kalender hur länge kvällen håller på" } as const;
    // Sluttid FÖRE starttid är tillåtet: kvällen passerar midnatt. Lika tider
    // ger däremot ett evenemang utan längd.
    if (eventEndTime === eventTime) {
      return { error: "Sluttiden kan inte vara samma som starttiden" } as const;
    }
  }
  if (!category || !EVENT_CATEGORIES.includes(category as (typeof EVENT_CATEGORIES)[number])) {
    return { error: "Välj en giltig kategori" } as const;
  }

  // Map form tier values to DB constraint values: '' → 'a', 'guld' → 'b', 'premium' → 'c'
  const tierMap: Record<string, string> = { guld: "b", premium: "c" };
  const dbTier = eventTier ? tierMap[eventTier] ?? "a" : "a";

  // Parse experience details
  const experienceDetails: Record<string, unknown> = {};
  if (amenitiesRaw) {
    experienceDetails.amenities = amenitiesRaw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (includedRaw) {
    experienceDetails.included = includedRaw.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const price = priceRaw ? parseInt(priceRaw, 10) : null;
  const duration_minutes = durationRaw ? parseInt(durationRaw, 10) : null;
  const min_guests = minGuestsRaw ? parseInt(minGuestsRaw, 10) : 1;
  const max_guests = maxGuestsRaw ? parseInt(maxGuestsRaw, 10) : null;

  if (price !== null && (isNaN(price) || price < 0)) {
    return { error: "Priset måste vara 0 eller högre" } as const;
  }
  if (duration_minutes !== null && (isNaN(duration_minutes) || duration_minutes <= 0)) {
    return { error: "Längden måste vara ett positivt tal" } as const;
  }
  if (isNaN(min_guests) || min_guests < 1) {
    return { error: "Minsta antal gäster måste vara minst 1" } as const;
  }
  if (max_guests !== null && (isNaN(max_guests) || max_guests < min_guests)) {
    return { error: "Max gäster måste vara lika med eller högre än min gäster" } as const;
  }

  return {
    data: {
      title,
      description: description || null,
      category,
      price,
      duration_minutes,
      event_tier: dbTier,
      image_url: imageUrl,
      event_date: eventDate,
      event_time: eventTime,
      event_end_time: eventEndTime,
      event_location: eventLocation,
      event_city: eventCity,
      event_venue: eventVenue,
      venue_profile_id: venueProfileId,
      event_lat: eventLat,
      event_lng: eventLng,
      event_place_id: eventPlaceId,
      listing_type: listingType,
      open_to_instructors: openToInstructors,
      service_fee_mode: serviceFeeMode,
      min_guests,
      max_guests,
      experience_details: experienceDetails,
    },
  } as const;
}

type ParsedTicketType = {
  id: string | null;
  name: string;
  price: number;
  capacity: number | null;
  /** Potterna typen drar från. Flera för en kombinationsbiljett. */
  pools: string[];
};

/** Parse the ticket-types editor (a JSON hidden field). Empty/invalid → []. */
function parseTicketTypes(formData: FormData): ParsedTicketType[] {
  const raw = formData.get("ticket_types");
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((t) => {
        const capRaw = t?.capacity;
        const capNum = capRaw != null && String(capRaw).trim() !== "" ? parseInt(String(capRaw), 10) : NaN;
        const id = typeof t?.id === "string" && t.id.length >= 32 ? t.id : null;
        return {
          id,
          name: String(t?.name ?? "").trim(),
          price: Math.max(0, parseInt(String(t?.price ?? "0"), 10) || 0),
          capacity: Number.isFinite(capNum) && capNum > 0 ? capNum : null,
          pools: parsePoolNames(t?.pools ?? t?.pool),
        };
      })
      .filter((t) => t.name.length > 0);
  } catch {
    return [];
  }
}

/**
 * Reconcile a listing's ticket types to the submitted set, preserving
 * tickets_sold on rows that survive: rows carrying an id are updated, rows
 * without one are inserted, and existing rows absent from the set are deleted.
 * Every write is scoped to listing_id so a spoofed id can't touch another event.
 */
async function reconcileTicketTypes(
  supabase: SupabaseClient,
  listingId: string,
  types: ParsedTicketType[]
) {
  const { data: existing } = await supabase
    .from("ticket_types")
    .select("id")
    .eq("listing_id", listingId);
  const existingIds = new Set((existing ?? []).map((r: { id: string }) => r.id));

  const keptIds = types.map((t) => t.id).filter((id): id is string => !!id && existingIds.has(id));
  const toDelete = [...existingIds].filter((id) => !keptIds.includes(id));
  if (toDelete.length > 0) {
    await supabase.from("ticket_types").delete().eq("listing_id", listingId).in("id", toDelete);
  }

  // Potterna först, så typerna har något att peka på. Potter som inte längre
  // används tas bort — en pott utan medlemmar är ett tak ingen räknar mot.
  const pools = resolvePools(types);
  const poolIds = new Map<string, string>();

  const { data: existingPools } = await supabase
    .from("ticket_pools")
    .select("id, name")
    .eq("listing_id", listingId);

  for (const ep of existingPools ?? []) {
    if (!pools.some((p) => p.name === ep.name)) {
      await supabase.from("ticket_pools").delete().eq("id", ep.id).eq("listing_id", listingId);
    }
  }

  for (const pool of pools) {
    const found = (existingPools ?? []).find((ep: { name: string }) => ep.name === pool.name);
    if (found) {
      await supabase.from("ticket_pools").update({ capacity: pool.capacity })
        .eq("id", found.id).eq("listing_id", listingId);
      poolIds.set(pool.name, found.id);
    } else {
      const { data: created } = await supabase.from("ticket_pools")
        .insert({ listing_id: listingId, name: pool.name, capacity: pool.capacity })
        .select("id").single();
      if (created) poolIds.set(pool.name, created.id);
    }
  }

  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const rad = { name: t.name, capacity: t.capacity, pools: t.pools };
    const fields = {
      name: t.name,
      price: t.price,
      capacity: ownCapacityFor(rad),
      sort_order: i,
    };

    let typeId = t.id && existingIds.has(t.id) ? t.id : null;
    if (typeId) {
      await supabase.from("ticket_types").update(fields).eq("id", typeId).eq("listing_id", listingId);
    } else {
      const { data: created } = await supabase
        .from("ticket_types")
        .insert({ listing_id: listingId, ...fields })
        .select("id")
        .single();
      typeId = created?.id ?? null;
    }
    if (!typeId) continue;

    // Kopplingarna sätts om från grunden. Att räkna ut skillnaden mot vad som
    // fanns vore fler rader kod för att spara två skrivningar, och kopplingarna
    // bär ingen egen data som kan gå förlorad.
    await supabase.from("ticket_type_pools").delete().eq("ticket_type_id", typeId);
    const rader = t.pools
      .map((namn) => poolIds.get(namn))
      .filter((id): id is string => !!id)
      .map((pool_id) => ({ ticket_type_id: typeId as string, pool_id }));
    if (rader.length > 0) {
      await supabase.from("ticket_type_pools").insert(rader);
    }
  }
}

export async function createEvent(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  // Skapas evenemanget i en lokals namn? Då är LOKALEN ägare av raden, eftersom
  // det är den kopplingen pengarna följer — ett evenemang som ägs av medlemmen
  // personligen skulle skicka intäkten fel och lämna delningsavtalet hängande.
  //
  // Valet valideras mot medlemskapet och inte mot det klienten påstår, så ett
  // manipulerat formulär inte kan lägga ett evenemang i någon annans lokal.
  const requestedVenue = (formData.get("create_as_venue") as string)?.trim() || null;
  let ownerId = user.id;
  let createdBy: string | null = null;

  if (requestedVenue && requestedVenue !== user.id) {
    const allowed = await venuesUserCanCreateFor(user.id);
    if (!allowed.some((v) => v.id === requestedVenue)) {
      return { error: "Du får inte skapa evenemang för den lokalen." };
    }
    ownerId = requestedVenue;
    createdBy = user.id;
  }

  // BankID-grinden gäller den som PUBLICERAS, inte den som klickar. Annars
  // skulle en lokal inte kunna delegera till sin personal utan att köra var och
  // en genom BankID, vilket vore att bygga in det problem delegeringen ska lösa.
  if (!(await isBankidCleared(supabase, ownerId))) {
    return { error: BANKID_REQUIRED_MSG };
  }

  // Check listing limit for user's tier — mot ägaren, eftersom det är dennes
  // plan evenemanget belastar.
  const { tier } = await getSubscriptionStatus(ownerId);
  const limit = await checkListingLimit(ownerId, tier);
  if (!limit.allowed) {
    return { error: `Du har nått maxgränsen (${limit.max}) för din plan. Uppgradera för att skapa fler.` };
  }

  const parsed = parseEventForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  // Ticket types (price tiers). When present, the listing price mirrors the
  // cheapest tier so existing "från X kr" displays keep working.
  const ticketTypes = parseTicketTypes(formData);
  const priceOverride = ticketTypes.length > 0 ? Math.min(...ticketTypes.map((t) => t.price)) : null;

  // Recurring series — generate one occurrence per date (only meaningful with
  // a start date). Each occurrence is its own bookable listing.
  const recurrence = (formData.get("recurrence") as string) || "none";
  const occRaw = parseInt((formData.get("occurrences") as string) || "1", 10);
  const occurrences = Math.min(Math.max(isNaN(occRaw) ? 1 : occRaw, 1), 52);
  const isSeries = recurrence !== "none" && !!parsed.data.event_date && occurrences > 1;

  const dates: (string | null)[] = isSeries
    ? computeSeriesDates(parsed.data.event_date as string, recurrence, occurrences)
    : [parsed.data.event_date];

  // The plan limit covers the whole series, not just one row.
  if (limit.max !== null) {
    const remaining = limit.max - limit.current;
    if (dates.length > remaining) {
      return {
        error:
          remaining <= 0
            ? `Du har nått maxgränsen (${limit.max}) för din plan. Uppgradera för att skapa fler.`
            : `Din plan tillåter ${remaining} till (max ${limit.max}). Minska antalet tillfällen eller uppgradera.`,
      };
    }
  }

  // A series shares one series_id + series_slug so the occurrences can be
  // grouped on a /series/<slug> landing page.
  const seriesId = isSeries ? crypto.randomUUID() : null;
  const seriesSlug = isSeries ? await generateUniqueSeriesSlug(supabase, parsed.data.title) : null;

  // Opt-in: auto-publish each occurrence to Facebook ~3 days before its date.
  const fbAutoPost = formData.get("fb_auto_post") === "on";

  // Opt-in: unlisted event — nåbart via direktlänk (slug) men dolt från
  // marknadsplats/browse (den "hemliga länken"). Default = publikt/listat.
  const isPublic = formData.get("unlisted") !== "on";

  // Tidsstyrd automatisering (förköpsfönster, schemalagt släpp, kapacitet).
  const automation = parseAutomation(formData);

  // Capability gate (only when enforcement is on): a non-tier-granted host
  // selling tickets must unlock event_pack. There's no listing row yet to hang
  // an event-scoped unlock on, so we create the event as a draft (is_active =
  // false) and let the unlock publish it. Never touches the buyer flow.
  const locked = await ticketGateForNewEvent(tier, parsed.data.price, parsed.data.max_guests);

  // Build one listing per date, each with its own date-based slug.
  const taken = new Set<string>();
  const rows = [];
  for (const d of dates) {
    rows.push({
      ...parsed.data,
      ...(priceOverride !== null ? { price: priceOverride } : {}),
      user_id: ownerId,
      created_by: createdBy,
      // En lokal som lägger upp sitt eget arrangemang behöver inte bekräfta åt
      // sig själv. Alla andra kopplingar väntar på lokalens ja.
      venue_confirmed_at:
        parsed.data.venue_profile_id && parsed.data.venue_profile_id === ownerId
          ? new Date().toISOString()
          : null,
      event_date: d,
      is_active: !locked,
      is_public: isPublic,
      ...automation,
      slug: await generateUniqueListingSlug(supabase, parsed.data.title, {
        dateSuffix: d ?? undefined,
        taken,
      }),
      series_id: seriesId,
      series_slug: seriesSlug,
      fb_auto_post: fbAutoPost,
    });
  }

  const { data: created, error } = await supabase
    .from("listings")
    .insert(rows)
    .select("id, title, event_date, event_location, image_url");

  if (error || !created?.length) return { error: "Kunde inte skapa evenemanget. Försök igen." };

  // Persist ticket types for every created occurrence.
  if (ticketTypes.length > 0) {
    for (const l of created) {
      await reconcileTicketTypes(supabase, l.id, ticketTypes);
    }
  }

  // Draft pending unlock: don't advertise it yet. Send the host to the event's
  // dashboard, where the UnlockGate prompts them to unlock (which publishes it).
  if (locked) {
    revalidatePath("/app/events");
    return { success: true as const, id: created[0].id, locked: true as const };
  }

  // Auto-post to feed — one post for the first occurrence (a series notes the rest).
  const first = created[0];
  const dateLabel = first.event_date
    ? new Date(first.event_date).toLocaleDateString("sv-SE", { day: "numeric", month: "long" })
    : null;
  const seriesNote = isSeries ? ` (+${created.length - 1} fler tillfällen)` : "";
  const text = dateLabel
    ? `Nytt event: ${first.title} — ${dateLabel}${seriesNote}${first.event_location ? ` i ${first.event_location}` : ""}. Välkommen!`
    : `Nytt event: ${first.title}${first.event_location ? ` i ${first.event_location}` : ""}. Välkommen!`;

  await supabase.from("posts").insert({
    user_id: user.id,
    text,
    image_url: first.image_url,
    listing_id: first.id,
  });

  // Säg till lokalen. Kopplingen ger arrangören plats på lokalens sida och
  // mejlar lokalens följare, så den händer inte förrän lokalen svarat ja — och
  // förr sa ingenting till att det låg och väntade. Bacchi fick åtta kvällar
  // liggande i två dygn och fick veta det via ett meddelande utanför appen.
  //
  // En notis per serie, inte per kväll: åtta bjällror för samma beslut är inte
  // åtta gånger tydligare, bara åtta gånger mer att avfärda.
  const venueId = parsed.data.venue_profile_id;
  if (venueId && venueId !== ownerId) {
    const { data: me } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", ownerId)
      .maybeSingle();
    await createNotification({
      userId: venueId,
      type: "venue_request",
      titleKey: "venueRequestTitle",
      bodyKey: "venueRequestMsg",
      params: { organiser: me?.full_name ?? first.title, count: created.length },
      link: "/app/venue-requests",
    });
  }

  revalidatePath("/app/events");
  revalidatePath("/app");
  revalidatePath("/app/posts");
  redirect("/app/events");
}

export async function duplicateEvent(
  sourceId: string,
  newDate: string,
  newTime: string | null,
  newEndTime: string | null
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };
  if (!newDate) return { error: "Datum krävs" };
  // Samma krav som när ett evenemang skapas. Utan det kunde en dubblett bli
  // den enda vägen till ett evenemang utan sluttid — och därmed till en
  // kalenderpost som gissar längden.
  if (!newTime) return { error: "Ange starttid för evenemanget" };
  if (!newEndTime) return { error: "Ange sluttid — annars vet inte besökarens kalender hur länge kvällen håller på" };
  if (newEndTime === newTime) return { error: "Sluttiden kan inte vara samma som starttiden" };

  if (!(await isBankidCleared(supabase, user.id))) {
    return { error: BANKID_REQUIRED_MSG };
  }

  const { tier } = await getSubscriptionStatus(user.id);
  const limit = await checkListingLimit(user.id, tier);
  if (!limit.allowed) {
    return { error: `Du har nått maxgränsen (${limit.max}) för din plan. Uppgradera för att skapa fler.` };
  }

  const { data: src, error: fetchErr } = await supabase
    .from("listings")
    .select("title, description, category, price, duration_minutes, event_tier, image_url, event_location, event_lat, event_lng, event_place_id, listing_type, min_guests, max_guests, experience_details, capacity")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !src) return { error: "Hittade inte originalet." };

  const slug = await generateUniqueListingSlug(supabase, src.title, { dateSuffix: newDate });

  const { data: cloned, error: insErr } = await supabase
    .from("listings")
    .insert({
      ...src,
      user_id: user.id,
      event_date: newDate,
      event_time: newTime,
      event_end_time: newEndTime,
      is_active: true,
      slug,
    })
    .select("id, title, event_date, event_location, image_url")
    .single();

  if (insErr || !cloned) return { error: "Kunde inte duplicera evenemanget." };

  const text = `Nytt event: ${cloned.title} — ${new Date(newDate).toLocaleDateString("sv-SE", { day: "numeric", month: "long" })}${cloned.event_location ? ` i ${cloned.event_location}` : ""}. Välkommen!`;

  await supabase.from("posts").insert({
    user_id: user.id,
    text,
    image_url: cloned.image_url,
    listing_id: cloned.id,
  });

  revalidatePath("/app/events");
  revalidatePath("/app");
  revalidatePath("/app/posts");
  return { success: true, id: cloned.id };
}

export async function updateEvent(id: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  if (!(await isBankidCleared(supabase, user.id))) {
    return { error: BANKID_REQUIRED_MSG };
  }

  // Authorize: the owner OR an accepted co-organizer (can_manage). Co-organizers
  // administer the event but never own it, so all writes below go through the
  // service-role client after this check (RLS on listings is owner-only).
  const admin = createAdminClient();
  const { data: L } = await admin
    .from("listings")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!L) return { error: "Evenemanget hittades inte." };
  const isOwner = L.user_id === user.id;
  if (!isOwner && !(await canManageListing(admin, user.id, id))) {
    return { error: "Du har inte behörighet att redigera det här evenemanget." };
  }

  const parsed = parseEventForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const ticketTypes = parseTicketTypes(formData);
  const priceOverride = ticketTypes.length > 0 ? Math.min(...ticketTypes.map((t) => t.price)) : null;
  const effectivePrice = priceOverride ?? parsed.data.price;

  // Capability gate (only when enforcement is on): a host turning an event into
  // a ticketed one must have unlocked event_pack for it. We never gate an event
  // that already has bookings — pulling the rug after guests have tickets is the
  // exact rug-pull the design forbids. Buyer checkout is never touched.
  // Count via admin so RLS can't hide a booking and make us wrongly gate it.
  const { count: bookingCount } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", id)
    .in("status", ["confirmed", "completed"]);

  // The gate reflects the OWNER's event_pack unlock, so only run it for the
  // owner. A co-organizer edits an event the owner already set up as ticketed.
  if (isOwner && !bookingCount) {
    const locked = await ticketGateForListing(
      supabase,
      user.id,
      id,
      effectivePrice,
      parsed.data.max_guests
    );
    if (locked) return { success: true as const, id, locked: true as const };
  }

  // Backfill a slug for older events that never got one. Existing slugs are
  // left untouched so already-shared links keep working — EXCEPT a series
  // occurrence with no bookings whose date changed: re-slug it so the date in
  // the slug matches (this is the duplicate→set-new-date flow; a copy inherits
  // the source date's slug, and gets corrected here once the real date is set).
  const { data: current } = await admin
    .from("listings")
    .select("slug, event_date, series_id, venue_profile_id")
    .eq("id", id)
    .single();

  const updateData: Record<string, unknown> = { ...parsed.data };

  // Bekräftelsen hör ihop med EN bestämd lokal. Byter arrangören lokal måste
  // den nya säga ja för sig — annars hade ett ja från Bacchi kunnat bäras över
  // till en annan lokal och användas för att mejla dess följare. Är lokalen
  // oförändrad rörs kolumnen inte alls, så en titeländring inte avbekräftar.
  const venueChanged = (current?.venue_profile_id ?? null) !== (parsed.data.venue_profile_id ?? null);
  if (venueChanged) {
    updateData.venue_confirmed_at =
      parsed.data.venue_profile_id && parsed.data.venue_profile_id === user.id
        ? new Date().toISOString()
        : null;
  }
  if (priceOverride !== null) updateData.price = priceOverride;
  updateData.is_public = formData.get("unlisted") !== "on";
  Object.assign(updateData, parseAutomation(formData));
  const dateChanged =
    !!current && current.event_date !== (parsed.data.event_date ?? null);
  const reslugSeriesOccurrence =
    !!current?.series_id && dateChanged && !bookingCount;
  if (current && (!current.slug || reslugSeriesOccurrence)) {
    updateData.slug = await generateUniqueListingSlug(admin, parsed.data.title, {
      excludeId: id,
      dateSuffix: parsed.data.event_date ?? undefined,
    });
  }

  const { error } = await admin
    .from("listings")
    .update(updateData)
    .eq("id", id);

  if (error) return { error: "Kunde inte uppdatera evenemanget. Försök igen." };

  // Sync ticket types, preserving tickets_sold on surviving rows.
  await reconcileTicketTypes(admin, id, ticketTypes);

  revalidatePath("/app/events");
  redirect("/app/events");
}

export async function deleteEvent(id: string) {
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

  if (error) return { error: "Kunde inte ta bort evenemanget." };

  revalidatePath("/app/events");
  return { success: true };
}

export async function toggleEventActive(id: string, isActive: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Ej inloggad" };

  // Owner or accepted co-organizer may publish/unpublish. Mutate via service role
  // after the check (listings RLS is owner-only; co-organizers don't own the row).
  const admin = createAdminClient();
  const { data: L } = await admin.from("listings").select("user_id").eq("id", id).maybeSingle();
  if (!L) return { error: "Evenemanget hittades inte." };
  if (L.user_id !== user.id && !(await canManageListing(admin, user.id, id))) {
    return { error: "Du har inte behörighet att ändra det här evenemanget." };
  }

  const { error } = await admin
    .from("listings")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) return { error: "Kunde inte ändra status." };

  revalidatePath("/app/events");
  return { success: true };
}

// ── Instructor opt-in: offer paid mini-sessions at someone's open event ──

const INSTRUCTOR_TIERS = ["guld", "premium"];

/**
 * A paying dance-instructor creator joins an open event so they can sell
 * 15/30/45/60-minute mini-sessions there. Gating mirrors the RLS policy on
 * event_instructors, but returns clear Swedish messages first.
 */
export async function joinOpenEvent(listingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Ej inloggad" };

  if (!(await isBankidCleared(supabase, user.id))) {
    return { error: BANKID_REQUIRED_MSG };
  }

  // stripe_account_id är kolumn-låst för authenticated — egen rad via service-role.
  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("role, tier, offers_coaching, coaching_hourly_rate_sek, stripe_account_id")
    .eq("id", user.id)
    .single();

  if (!profile || !isCreatorRole(profile.role)) {
    return { error: "Endast instruktörer (kreatörer) kan gå med." };
  }
  if (!INSTRUCTOR_TIERS.includes(profile.tier)) {
    return { error: "Du behöver en Guld- eller Premium-prenumeration för att erbjuda tjänster på event." };
  }
  if (!profile.offers_coaching || !profile.coaching_hourly_rate_sek || profile.coaching_hourly_rate_sek <= 0) {
    return { error: "Aktivera coaching och sätt ett timpris i din profil först." };
  }
  if (!profile.stripe_account_id) {
    return { error: "Anslut Stripe för att ta emot betalningar först." };
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("id, is_active, open_to_instructors")
    .eq("id", listingId)
    .single();
  if (!listing || !listing.is_active || !listing.open_to_instructors) {
    return { error: "Eventet är inte öppet för instruktörer." };
  }

  const { error } = await supabase
    .from("event_instructors")
    .insert({ listing_id: listingId, instructor_id: user.id });

  if (error) {
    if (error.code === "23505") return { success: true }; // already joined — idempotent
    return { error: "Kunde inte gå med. Försök igen." };
  }

  revalidatePath("/app/events/open");
  revalidatePath(`/listing/${listingId}`);
  return { success: true };
}

/**
 * Instructor leaves an open event. Only stops NEW sales — already-sold minute
 * credits remain valid bookings the instructor still redeems.
 */
export async function leaveOpenEvent(listingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Ej inloggad" };

  const { error } = await supabase
    .from("event_instructors")
    .delete()
    .eq("listing_id", listingId)
    .eq("instructor_id", user.id);

  if (error) return { error: "Kunde inte lämna eventet." };

  revalidatePath("/app/events/open");
  revalidatePath(`/listing/${listingId}`);
  return { success: true };
}
