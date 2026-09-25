import type { ListingType } from "@/types/database";

/**
 * Vilka annonstyper som bara taxidansare får publicera.
 *
 * Klippkort (`package`) låg här förut, som ett arv från när funktionen hette
 * danspaket och bara fanns för taxidansare. Men ett klippkort är inte
 * dansspecifikt: en boxningstränare säljer 5- och 10-passkort på exakt samma
 * sätt. Coaching och B2B är däremot taxidansarnas egna erbjudanden och
 * förblir låsta.
 *
 * Grinden finns på tre ställen — skapa, uppdatera och i formuläret som
 * bestämmer vilka alternativ som visas. Den bor här så att de tre inte kan
 * glida isär; en server som tillåter något gränssnittet döljer är lika fel
 * som tvärtom.
 */
const TAXI_DANCER_ONLY: ReadonlySet<string> = new Set(["coaching_session", "b2b_offering"]);

export function requiresTaxiDancer(listingType: ListingType | string): boolean {
  return TAXI_DANCER_ONLY.has(listingType);
}

/** Får den här kreatören publicera typen? */
export function canPublishListingType(
  listingType: ListingType | string,
  creatorSubcategory: string | null | undefined
): boolean {
  return !requiresTaxiDancer(listingType) || creatorSubcategory === "taxi_dancer";
}
