// Dokumentbiblioteket för uppläsaren.
//
// Texterna någon klistrar in är privata anteckningar, artiklar och manus —
// de ligger i webbläsarens localStorage och lämnar aldrig enheten. Ingen
// tabell, ingen RLS-policy och inget att glömma att städa. Priset är att
// biblioteket inte följer med mellan enheter; det står i UI:t.

export type DocumentSource = "paste" | "file" | "url";

export interface ListenDocument {
  id: string;
  title: string;
  text: string;
  source: DocumentSource;
  /** Ursprungsadressen för importerade artiklar. */
  url?: string;
  createdAt: number;
  updatedAt: number;
  /** Läspositionen som teckenindex i texten. */
  progress: number;
}

export const STORAGE_KEY = "usha.listen.documents";

/** Så många dokument sparas. Äldst uppdaterat faller ur först. */
export const MAX_DOCUMENTS = 40;
/** Taket för ett enskilt dokument — ~250 sidor text. */
export const MAX_DOCUMENT_CHARS = 500_000;
/**
 * Taket för hela biblioteket. localStorage ger typiskt 5 MB per origin och
 * appen lagrar annat där också, så uppläsaren tar en dryg tredjedel.
 */
export const MAX_TOTAL_CHARS = 1_500_000;

/** Bara det localStorage-API vi faktiskt använder — gör lagret testbart. */
export interface DocumentStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isDocument(value: unknown): value is ListenDocument {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.title === "string" &&
    typeof d.text === "string" &&
    typeof d.createdAt === "number" &&
    typeof d.updatedAt === "number"
  );
}

/**
 * Läser biblioteket. Trasig eller manipulerad JSON ger tomt bibliotek i
 * stället för ett kastat fel — en läsare som vägrar öppna är värre än en
 * som öppnar tom.
 */
export function loadDocuments(store: DocumentStore): ListenDocument[] {
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDocument).map((d) => ({
      ...d,
      source: (["paste", "file", "url"] as const).includes(d.source) ? d.source : "paste",
      progress: typeof d.progress === "number" && d.progress >= 0 ? d.progress : 0,
    }));
  } catch {
    return [];
  }
}

/** Nyast uppdaterat först — bibliotekets visningsordning. */
function sorted(docs: ListenDocument[]): ListenDocument[] {
  return [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Håller biblioteket inom både antals- och teckenbudgeten. */
function prune(docs: ListenDocument[]): ListenDocument[] {
  const kept: ListenDocument[] = [];
  let total = 0;
  for (const doc of sorted(docs).slice(0, MAX_DOCUMENTS)) {
    if (total + doc.text.length > MAX_TOTAL_CHARS && kept.length > 0) break;
    kept.push(doc);
    total += doc.text.length;
  }
  return kept;
}

/**
 * Skriver biblioteket. Slår kvoten i taket kastas det äldsta dokumentet och
 * skrivningen görs om, så att ett nytt dokument aldrig går förlorat för att
 * ett gammalt ligger kvar.
 */
function persist(store: DocumentStore, docs: ListenDocument[]): ListenDocument[] {
  let candidates = prune(docs);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(candidates));
      return candidates;
    } catch {
      if (candidates.length <= 1) break;
      candidates = candidates.slice(0, -1);
    }
  }
  return candidates;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Första raden med innehåll, kortad — bättre än "Namnlöst" som titel. */
export function titleFromText(text: string, fallback: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return fallback;
  const trimmed = line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
  return trimmed;
}

export interface NewDocument {
  title?: string;
  text: string;
  source: DocumentSource;
  url?: string;
}

/** Lägger till ett dokument och returnerar det sparade biblioteket. */
export function addDocument(
  store: DocumentStore,
  input: NewDocument,
  fallbackTitle = "Namnlöst dokument"
): { documents: ListenDocument[]; document: ListenDocument } {
  const now = Date.now();
  const text = input.text.slice(0, MAX_DOCUMENT_CHARS);
  const document: ListenDocument = {
    id: makeId(),
    title: (input.title?.trim() || titleFromText(text, fallbackTitle)).slice(0, 120),
    text,
    source: input.source,
    ...(input.url ? { url: input.url } : {}),
    createdAt: now,
    updatedAt: now,
    progress: 0,
  };
  const documents = persist(store, [document, ...loadDocuments(store)]);
  return { documents, document };
}

export function deleteDocument(store: DocumentStore, id: string): ListenDocument[] {
  return persist(
    store,
    loadDocuments(store).filter((d) => d.id !== id)
  );
}

/**
 * Sparar läspositionen. Positionen klampas in i texten så att ett dokument
 * inte kan öppnas på en position som inte finns.
 */
export function saveProgress(
  store: DocumentStore,
  id: string,
  progress: number
): ListenDocument[] {
  const docs = loadDocuments(store);
  const target = docs.find((d) => d.id === id);
  if (!target) return docs;
  const clamped = Math.max(0, Math.min(Math.round(progress), target.text.length));
  if (clamped === target.progress) return docs;
  return persist(
    store,
    docs.map((d) =>
      // updatedAt rörs inte: att lyssna färdigt ska inte kasta ut ett annat
      // dokument ur biblioteket genom att flytta om sorteringen.
      d.id === id ? { ...d, progress: clamped } : d
    )
  );
}

export function renameDocument(
  store: DocumentStore,
  id: string,
  title: string
): ListenDocument[] {
  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) return loadDocuments(store);
  return persist(
    store,
    loadDocuments(store).map((d) =>
      d.id === id ? { ...d, title: trimmed, updatedAt: Date.now() } : d
    )
  );
}

/** Andel uppläst, 0–1. Ett tomt dokument räknas som oläst, inte färdigt. */
export function progressRatio(doc: ListenDocument): number {
  if (doc.text.length === 0) return 0;
  return Math.max(0, Math.min(1, doc.progress / doc.text.length));
}
