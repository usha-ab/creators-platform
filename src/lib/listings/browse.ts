/**
 * Vad som hör hemma i bläddringslistan på /upplevelser.
 *
 * Klippkort (listing_type "package") är inte något man går på — de är ett
 * betalsätt till evenemang som redan står i samma lista. Sex kort för The Lab
 * konkurrerade alltså med The Labs egna kvällar, och trängde undan riktiga
 * tjänster till sida två.
 *
 * De försvinner inte: de ligger kvar på arrangörens profil i en egen sektion,
 * och som val i biljettrutan på varje kväll de gäller — alltså där någon redan
 * bestämt sig för att gå, vilket är det enda läge ett klippkort betyder något.
 *
 * NULL-säkert med flit. `.neq("listing_type", "package")` hade tyst släppt en
 * rad utan typ, eftersom NULL != 'package' är NULL och inte sant. En listning
 * utan typ ska synas, inte försvinna.
 */
export const BROWSABLE_TYPES = "listing_type.is.null,listing_type.neq.package";
