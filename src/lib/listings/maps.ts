/**
 * Länken ut till Google Maps för en plats.
 *
 * Prioriterar NAMNET framför koordinaterna: koordinater ger en namnlös nål —
 * ingen infokarta, inga öppettider, inget foto, bara "59.32, 18.07". Med
 * namnet öppnas stället som ett ställe, med Vägbeskrivning-knappen och allt
 * Google vet om det. place_id läggs till när det finns, så rätt ställe träffas
 * även när namnet är tvetydigt.
 *
 * Bodde tidigare inne i EventMap. Ligger här för att kartan och adressraden i
 * sidhuvudet ska peka på exakt samma ställe.
 */
export function buildMapsHref({
  location,
  city,
  placeId,
  lat,
  lng,
}: {
  location?: string | null;
  city?: string | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  // Staden läggs till bara när adressen inte redan nämner den, annars blir
  // frågan "Bacchi Syre, Stockholm, Stockholm".
  const namedQuery =
    location && city && !location.toLowerCase().includes(city.toLowerCase())
      ? `${location}, ${city}`
      : location;

  if (namedQuery) {
    return (
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(namedQuery)}` +
      (placeId ? `&query_place_id=${placeId}` : "")
    );
  }
  if (typeof lat === "number" && typeof lng === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  return "https://www.google.com/maps";
}
