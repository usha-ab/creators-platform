import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_DESTINATIONS, ADMIN_ROOT, adminDestinationsFor } from "../registry";
import { ADMIN_CAPABILITIES, canChangeAdminLevel, isAdminCapability } from "@/lib/admin/capabilities";

const APP_DIR = path.join(process.cwd(), "src", "app");
const ADMIN_DIR = path.join(APP_DIR, "(dashboard)", "dashboard", "admin");
const LOCALES = ["sv", "en", "es"] as const;

function pageFileFor(route: string): string {
  // Route groups like (dashboard) don't appear in the URL.
  return path.join(APP_DIR, "(dashboard)", `${route}`, "page.tsx");
}

function adminPages(dir = ADMIN_DIR, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) adminPages(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

describe("adminmenyn pekar på sidor som finns", () => {
  it("har ett nav att hänga verktygen under", () => {
    expect(fs.existsSync(pageFileFor(ADMIN_ROOT))).toBe(true);
  });

  for (const dest of ADMIN_DESTINATIONS) {
    it(`${dest.path} har en page.tsx`, () => {
      expect(fs.existsSync(pageFileFor(dest.path))).toBe(true);
    });
  }

  it("varje verktyg har etikett och beskrivning på alla språk", () => {
    const missing: string[] = [];
    for (const locale of LOCALES) {
      const messages = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), `src/i18n/messages/${locale}.json`), "utf8")
      );
      const ns = messages.adminPage ?? {};
      for (const dest of ADMIN_DESTINATIONS) {
        for (const key of [dest.labelKey, dest.descKey]) {
          if (ns[key] == null) missing.push(`${locale}: adminPage.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("adminsidorna är skyddade", () => {
  // The tools used to be reachable only by typing their URL, which quietly did
  // some of the work. Now that a menu points at them, the server-side check is
  // the only thing standing between a curious user and an admin tool — so a new
  // page that forgets it fails the build rather than shipping open.
  const pages = adminPages();

  it("hittar adminsidorna överhuvudtaget (skyddar mot att testet tystnar)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(ADMIN_DESTINATIONS.length + 1);
  });

  for (const file of pages) {
    const rel = file.slice(process.cwd().length + 1);
    it(`${rel} går genom en behörighetsgrind`, () => {
      const src = fs.readFileSync(file, "utf8");
      expect(src, `${rel} saknar requireAdmin/requireAnyAdmin`).toMatch(
        /\b(requireAdmin|requireAnyAdmin)\(/
      );
    });
  }

  // Server actions can't redirect their way out of a refusal, so they get their
  // own gate — and every one of them needs it: an action reached directly is a
  // page that was never opened.
  const actionFiles = fs
    .readdirSync(ADMIN_DIR, { recursive: true, encoding: "utf8" })
    .map((f) => path.join(ADMIN_DIR, f))
    .filter((f) => f.endsWith("actions.ts") && fs.statSync(f).isFile());

  it("hittar action-filerna (skyddar mot att testet tystnar)", () => {
    expect(actionFiles.length).toBeGreaterThan(0);
  });

  for (const file of actionFiles) {
    const rel = file.slice(process.cwd().length + 1);
    it(`${rel}: varje exporterad action kräver behörighet`, () => {
      const src = fs.readFileSync(file, "utf8");
      const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
      expect(exported.length, `${rel} exporterar inga actions`).toBeGreaterThan(0);
      // Either the action asserts directly, or through a local wrapper that does.
      expect(src, `${rel} saknar assertAdmin`).toContain("assertAdmin(");
      for (const name of exported) {
        const body = src.slice(src.indexOf(`export async function ${name}`));
        const upToNext = body.slice(0, body.indexOf("\nexport ", 1) + 1 || undefined);
        expect(upToNext, `${rel}: ${name} kollar inte behörighet`).toMatch(
          /assertAdmin\(|requireCaller\(/
        );
      }
    });
  }
});

describe("behörighetsmodellen hänger ihop", () => {
  it("varje verktyg kräver antingen en känd kapacitet eller hel admin", () => {
    for (const d of ADMIN_DESTINATIONS) {
      expect(
        d.requires === "full" || isAdminCapability(d.requires),
        `${d.path} kräver "${d.requires}", som varken är "full" eller en känd kapacitet`
      ).toBe(true);
    }
  });

  it("varje kapacitet motsvarar ett verktyg som går att öppna", () => {
    // A capability nobody can spend is a permission that only looks like one.
    const spent = new Set(ADMIN_DESTINATIONS.map((d) => d.requires));
    expect(ADMIN_CAPABILITIES.filter((c) => !spent.has(c))).toEqual([]);
  });

  it("att dela ut behörighet går inte att delegera", () => {
    // The whole point: a partner who can widen their own grant isn't limited.
    const access = ADMIN_DESTINATIONS.find((d) => d.path.endsWith("/access"));
    expect(access, "behörighetsverktyget saknas i registret").toBeDefined();
    expect(access!.requires).toBe("full");
  });

  it("en partner ser bara det den har", () => {
    const partner = { full: false, capabilities: ["promo" as const] };
    const paths = adminDestinationsFor(partner).map((d) => d.path);
    expect(paths).toEqual(["/dashboard/admin/promo"]);
  });

  it("hel admin ser allt", () => {
    const boss = { full: true, capabilities: [...ADMIN_CAPABILITIES] };
    expect(adminDestinationsFor(boss).map((d) => d.path)).toEqual(
      ADMIN_DESTINATIONS.map((d) => d.path)
    );
  });

  it("utan behörighet syns ingenting", () => {
    expect(adminDestinationsFor({ full: false, capabilities: [] })).toEqual([]);
  });
});

describe("adminytan är läsbar för en partner som inte kan svenska", () => {
  // Admin used to be Pablo alone, so Swedish-only was fine. Partners are next,
  // and they get the same pages — so the admin surface follows the same rule as
  // the rest of the app: nothing hardcoded, everything through a key.
  //
  // The rule is "no literal visible text", not "no Swedish letters": plenty of
  // Swedish carries no å/ä/ö ("Totalt", "Ny promokod"), and a diacritic hunt
  // waves those straight through. Anything a reader can see has to arrive as an
  // expression.
  const ADMIN_SOURCES = [
    ...fs
      .readdirSync(ADMIN_DIR, { recursive: true, encoding: "utf8" })
      .map((f) => path.join(ADMIN_DIR, f))
      .filter((f) => /\.tsx?$/.test(f) && fs.statSync(f).isFile()),
    path.join(process.cwd(), "src/components/admin/admin-nav.tsx"),
  ];

  /** Attributes whose value the reader sees or hears. */
  const VISIBLE_ATTRS = /(?:placeholder|title|aria-label|alt)=("([^"]*)"|'([^']*)')/g;

  // Latin letters including the accented ones the three languages use (å ä ö
  // é ñ). Not \p{L}: the unicode property escape needs an ES2018 target and
  // tsconfig is on ES2017, so it type-errors even though vitest runs it.
  const HAS_WORDS = /[A-Za-zÀ-ÿ]{2,}/;

  function strip(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s\/\/[^\n"'`]*$/gm, "")
      .replace(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g, "")
      .replace(/style=\{\{[^}]*\}\}/g, "");
  }

  it("hittar filerna överhuvudtaget (skyddar mot att testet tystnar)", () => {
    expect(ADMIN_SOURCES.length).toBeGreaterThan(5);
  });

  it("ingen synlig text är hårdkodad", () => {
    const offenders: string[] = [];
    for (const file of ADMIN_SOURCES) {
      const rel = file.slice(process.cwd().length + 1);
      const code = strip(fs.readFileSync(file, "utf8"));

      // JSX text nodes: what sits between tags without being an expression.
      // The character class excludes anything that can only be code — a plain
      // `>` in a comparison would otherwise pair with a later `<` and drag a
      // whole block in as if it were prose.
      for (const m of code.matchAll(/>([^<>{}();=$[\]]+)</g)) {
        const text = m[1].trim();
        if (HAS_WORDS.test(text)) offenders.push(`${rel}: >${text}<`);
      }
      for (const m of code.matchAll(VISIBLE_ATTRS)) {
        const value = (m[2] ?? m[3] ?? "").trim();
        if (HAS_WORDS.test(value)) offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("varje adminnamnrymd finns fylld på alla tre språk", () => {
    const NAMESPACES = [
      "adminPage", "adminAccess", "adminCreators", "adminPromo", "adminPromoForm", "adminPromoTable", "adminPartners",
    ];
    const problems: string[] = [];
    for (const locale of LOCALES) {
      const messages = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), `src/i18n/messages/${locale}.json`), "utf8")
      );
      for (const ns of NAMESPACES) {
        const block = messages[ns];
        if (!block || Object.keys(block).length === 0) {
          problems.push(`${locale}: ${ns} saknas eller är tom`);
          continue;
        }
        for (const [key, value] of Object.entries(block)) {
          if (typeof value !== "string" || !value.trim()) problems.push(`${locale}: ${ns}.${key} är tom`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("nivåbytet kan inte låsa ute den som gör det", () => {
  it("vägrar när någon ändrar sin egen nivå", () => {
    // The last full admin demoting themselves leaves nobody who can grant
    // anything, and the way back is a database console.
    expect(canChangeAdminLevel("user-a", "user-a")).toBe(false);
  });

  it("tillåter när det är någon annan", () => {
    expect(canChangeAdminLevel("user-a", "user-b")).toBe(true);
  });

  it("vägrar när endera saknas", () => {
    expect(canChangeAdminLevel(null, "user-b")).toBe(false);
    expect(canChangeAdminLevel("user-a", undefined)).toBe(false);
    expect(canChangeAdminLevel(null, null)).toBe(false);
  });
});
