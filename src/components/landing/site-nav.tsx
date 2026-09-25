import { Nav } from "./nav";

/**
 * Toppmenyn för de publika sidorna.
 *
 * Frågade tidigare databasen om kalenderlänken skulle visas. Den grinden är
 * borta: menyn har numera en enda ingång till utbudet — Upplevelser — och
 * kalendern är en vy av samma sak, nåbar därifrån. Utan grinden slipper varje
 * sidvisning en fråga mot databasen, och menyn ser likadan ut för alla.
 */
export function SiteNav() {
  return <Nav />;
}
