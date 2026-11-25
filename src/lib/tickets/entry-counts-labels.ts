import { getTranslations } from "next-intl/server";
import { CHECKIN_PALETTE } from "./checkin-color";
import type { EntryCountsLabels } from "@/components/tickets/entry-counts-bar";

/** Räknarens och färgnamnens texter, hämtade på servern för kiosken och dörren. */
export async function entryCountsLabels(): Promise<EntryCountsLabels> {
  const c = await getTranslations("selfCheckin");
  return {
    sold: c("countsSold"),
    checkedIn: c("countsIn"),
    waiting: c("countsWaiting"),
    colorLabel: c("colorLabel"),
    colors: Object.fromEntries(CHECKIN_PALETTE.map((p) => [p.key, c(`colors.${p.key}`)])),
  };
}
