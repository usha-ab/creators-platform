/**
 * Skyddsnät för stående regler som inte hunnit med.
 *
 * Sedan arvet finns (trigger på listings) får varje NY kväll sina regler när
 * den skapas. Men arvet sker vid skapandet, och en kväll kan ändras efteråt:
 * kopplas till lokalen i ett senare steg, få en serie tilldelad, eller få sin
 * avräkning ändrad för hand. Då gäller inte längre det som står på lokalen och
 * serien, och ingenting säger ifrån.
 *
 * Den här modulen letar upp de avvikelserna. Ren funktion utan databas, av
 * samma skäl som delningen: den handlar om pengar och ska gå att testa
 * uttömmande.
 *
 * Den larmar om avvikelser, inte om läget. Ett larm som går varje natt slutar
 * läsas — därför är tomt resultat det normala och inget mejl skickas då.
 */

export interface NightInput {
  id: string;
  title: string;
  eventDate: string;
  venueProfileId: string | null;
  seriesSlug: string | null;
  /** Avräkningen som faktiskt ligger på kvällen, om någon. */
  share: { partnerProfileId: string; partnerPercent: number; vatRate: number; payoutDelayDays: number } | null;
  /** Koder som ligger på kvällen. */
  codes: string[];
  /** Medarrangörer som ligger på kvällen. */
  collaboratorUserIds: string[];
}

export interface VenueDefault {
  venueProfileId: string;
  partnerPercent: number;
  vatRate: number;
  payoutDelayDays: number;
}

export interface SeriesRules {
  seriesSlug: string;
  codes: string[];
  collaboratorUserIds: string[];
}

export type GapKind =
  | "saknar_avrakning"
  | "avrakning_avviker"
  | "saknar_kod"
  | "saknar_medarrangor";

export interface Gap {
  listingId: string;
  title: string;
  eventDate: string;
  kind: GapKind;
  /** Kort mening på svenska, färdig att läsa i ett mejl. */
  detalj: string;
}

export interface GapInput {
  nights: NightInput[];
  venueDefaults: VenueDefault[];
  seriesRules: SeriesRules[];
}

const procent = (n: number) => `${n} %`;

export function findGaps({ nights, venueDefaults, seriesRules }: GapInput): Gap[] {
  const perVenue = new Map(venueDefaults.map((d) => [d.venueProfileId, d]));
  const perSeries = new Map(seriesRules.map((r) => [r.seriesSlug, r]));
  const gaps: Gap[] = [];

  for (const night of nights) {
    const venueDefault = night.venueProfileId ? perVenue.get(night.venueProfileId) : undefined;

    if (venueDefault) {
      if (!night.share) {
        gaps.push({
          listingId: night.id,
          title: night.title,
          eventDate: night.eventDate,
          kind: "saknar_avrakning",
          detalj: `Lokalen har ett avtal på ${procent(venueDefault.partnerPercent)} men kvällen har ingen avräkning alls.`,
        });
      } else {
        // En andel kan vara medvetet ändrad för en enskild kväll. Den skillnad
        // som är värd att larma om är den ingen tagit ställning till — därför
        // står det "avviker", inte "är fel".
        const avvikelser: string[] = [];
        if (night.share.partnerProfileId !== venueDefault.venueProfileId) {
          avvikelser.push("annan mottagare än lokalen");
        }
        if (night.share.partnerPercent !== venueDefault.partnerPercent) {
          avvikelser.push(`${procent(night.share.partnerPercent)} i stället för ${procent(venueDefault.partnerPercent)}`);
        }
        if (Number(night.share.vatRate) !== Number(venueDefault.vatRate)) {
          avvikelser.push(`moms ${night.share.vatRate} i stället för ${venueDefault.vatRate}`);
        }
        if (night.share.payoutDelayDays !== venueDefault.payoutDelayDays) {
          avvikelser.push(
            `utbetalning efter ${night.share.payoutDelayDays} dagar i stället för ${venueDefault.payoutDelayDays}`
          );
        }
        if (avvikelser.length > 0) {
          gaps.push({
            listingId: night.id,
            title: night.title,
            eventDate: night.eventDate,
            kind: "avrakning_avviker",
            detalj: `Avräkningen skiljer sig från lokalens avtal: ${avvikelser.join(", ")}.`,
          });
        }
      }
    }

    const series = night.seriesSlug ? perSeries.get(night.seriesSlug) : undefined;
    if (!series) continue;

    const saknadeKoder = series.codes.filter((c) => !night.codes.includes(c));
    for (const kod of saknadeKoder) {
      gaps.push({
        listingId: night.id,
        title: night.title,
        eventDate: night.eventDate,
        kind: "saknar_kod",
        detalj: `Serien har den stående koden ${kod}, men kvällen saknar den.`,
      });
    }

    const saknadeMedarr = series.collaboratorUserIds.filter((u) => !night.collaboratorUserIds.includes(u));
    for (const uid of saknadeMedarr) {
      gaps.push({
        listingId: night.id,
        title: night.title,
        eventDate: night.eventDate,
        kind: "saknar_medarrangor",
        detalj: `Serien har en stående medarrangör (${uid}) som saknas på kvällen.`,
      });
    }
  }

  // Närmast i tiden först: det är den kvällen som hinner gå fel snabbast.
  return gaps.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.kind.localeCompare(b.kind));
}
