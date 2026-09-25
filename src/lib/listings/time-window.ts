/**
 * Datumfönstret för publika listor. Räknas i Europe/Stockholm — annars byter
 * sidorna innehåll klockan 01:00 svensk tid, när UTC slår över till nästa dag.
 *
 * Datumlösa listningar (tjänster, klippkort) hör hemma bland kommande, aldrig
 * bland passerade. Passerade finns kvar som bibliotek men visas bara på begäran.
 */
export function todayStockholm(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** PostgREST-uttryck för `.or(...)`: kommande eller utan datum. */
export function upcomingOrUndated(): string {
  return `event_date.is.null,event_date.gte.${todayStockholm()}`;
}

/** PostgREST-uttryck för `.or(...)`: enbart passerade. */
export function pastOnly(): string {
  return `event_date.lt.${todayStockholm()}`;
}
