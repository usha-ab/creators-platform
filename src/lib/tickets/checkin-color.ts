import { createHmac } from "node:crypto";

/**
 * Kvällens färg.
 *
 * Den levande biljetten i gästens telefon, kiosken och dörrskärmen visar samma
 * färg en given kväll. Den som står i dörren ser på ett ögonkast att biljetten
 * hör till I KVÄLL — en skärmdump från förra veckan har fel färg.
 *
 * Färgen får inte gå att räkna ut i förväg, annars kan vem som helst bygga en
 * falsk "grön biljett" hemma. Därför HMAC med en hemlighet som bara servern
 * har (CHECKIN_COLOR_SECRET), över listing-id + datum.
 *
 * Saknas hemligheten visas INGEN färg (null) och en varning loggas. Ett
 * reservvärde som går att gissa (t.ex. en hash utan nyckel) vore värre än
 * ingen färg alls: det ser skyddat ut men är det inte. Den levande biljetten
 * fungerar ändå — den är grön, animerad och visar klockslaget.
 */

export interface CheckinColor {
  /** Index i paletten, för test och felsökning. */
  index: number;
  /** Bakgrundsfärg (hex). */
  bg: string;
  /** Textfärg som håller kontrast mot bg. */
  fg: string;
  /** Nyckel för färgens namn i översättningarna (checkinColor.<key>). */
  key: string;
}

/**
 * Tolv nyanser som går att skilja åt på en mörk dörrskärm och i en telefon på
 * låg ljusstyrka. Ingen ren grön: grönt betyder redan "incheckad" i
 * biljettens egen yta. fg är vald så att kontrasten mot bg är minst 4.5:1.
 */
export const CHECKIN_PALETTE: readonly Omit<CheckinColor, "index">[] = [
  { key: "red", bg: "#D7263D", fg: "#FFFFFF" },
  { key: "orange", bg: "#F46036", fg: "#000000" },
  { key: "amber", bg: "#FFB400", fg: "#000000" },
  { key: "yellow", bg: "#F9E900", fg: "#000000" },
  { key: "lime", bg: "#A8E10C", fg: "#000000" },
  { key: "teal", bg: "#00A6A6", fg: "#000000" },
  { key: "cyan", bg: "#2EC4F1", fg: "#000000" },
  { key: "blue", bg: "#1B4DE4", fg: "#FFFFFF" },
  { key: "indigo", bg: "#4B2ABF", fg: "#FFFFFF" },
  { key: "violet", bg: "#9B30D9", fg: "#FFFFFF" },
  { key: "pink", bg: "#FF4FA3", fg: "#000000" },
  { key: "white", bg: "#F4F1F6", fg: "#000000" },
];

let warned = false;

/** Kortare hemligheter räknas som saknade. `openssl rand -hex 32` ger 64 tecken. */
export const MIN_SECRET_LENGTH = 32;

/** Ren kärna: samma indata och hemlighet ger alltid samma färg. */
export function checkinColorWithSecret(secret: string, listingId: string, eventDate: string): CheckinColor {
  const mac = createHmac("sha256", secret).update(`${listingId}|${eventDate.slice(0, 10)}`).digest();
  // Fyra byte som osignerat tal ger jämn fördelning över 12 platser.
  const index = mac.readUInt32BE(0) % CHECKIN_PALETTE.length;
  return { index, ...CHECKIN_PALETTE[index] };
}

/**
 * Kvällens färg, eller null om hemligheten saknas eller kvällen saknar datum.
 * Bara för serverkod — hemligheten får aldrig nå klienten.
 */
export function checkinColor(listingId: string, eventDate: string | null | undefined): CheckinColor | null {
  if (!eventDate) return null;
  const secret = process.env.CHECKIN_COLOR_SECRET?.trim();
  // En för kort hemlighet går att gissa sig fram till; behandla den som saknad.
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    if (!warned) {
      console.warn("CHECKIN_COLOR_SECRET saknas eller är för kort: kvällens färg visas inte på biljetten, kiosken eller dörren.");
      warned = true;
    }
    return null;
  }
  return checkinColorWithSecret(secret, listingId, eventDate);
}
