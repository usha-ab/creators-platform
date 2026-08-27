import { describe, it, expect, beforeEach } from "vitest";
import {
  addDocument,
  deleteDocument,
  loadDocuments,
  progressRatio,
  renameDocument,
  saveProgress,
  titleFromText,
  MAX_DOCUMENTS,
  STORAGE_KEY,
  type DocumentStore,
} from "../library";

/** localStorage-attrapp med valfritt tak, för att provocera kvotfel. */
function makeStore(limitChars = Infinity): DocumentStore & { raw(): string | null } {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      if (next.length > limitChars) throw new Error("QuotaExceededError");
      value = next;
    },
    raw: () => value,
  };
}

describe("addDocument", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("sparar dokumentet och returnerar det", () => {
    const { documents, document } = addDocument(store, { text: "Hej.", source: "paste" });
    expect(documents).toHaveLength(1);
    expect(document.text).toBe("Hej.");
    expect(loadDocuments(store)[0].id).toBe(document.id);
  });

  it("härleder titel ur första raden när ingen anges", () => {
    const { document } = addDocument(store, { text: "  \nMin rubrik\nBrödtext", source: "paste" });
    expect(document.title).toBe("Min rubrik");
  });

  it("använder angiven titel", () => {
    const { document } = addDocument(store, { title: " Artikel ", text: "x", source: "url", url: "https://ex.se" });
    expect(document.title).toBe("Artikel");
    expect(document.url).toBe("https://ex.se");
  });

  it("lägger nyaste först", () => {
    addDocument(store, { text: "Först.", source: "paste" });
    const { documents } = addDocument(store, { text: "Sedan.", source: "paste" });
    expect(documents[0].text).toBe("Sedan.");
  });

  it("håller biblioteket inom antalstaket", () => {
    for (let i = 0; i < MAX_DOCUMENTS + 5; i++) {
      addDocument(store, { text: `Dokument ${i}.`, source: "paste" });
    }
    expect(loadDocuments(store)).toHaveLength(MAX_DOCUMENTS);
  });

  it("kastar äldsta dokumentet när lagringskvoten tar slut", () => {
    const tight = makeStore(700);
    addDocument(tight, { text: "A".repeat(200), source: "paste" });
    addDocument(tight, { text: "B".repeat(200), source: "paste" });
    const docs = loadDocuments(tight);
    // Det nyaste måste finnas kvar även när det gamla inte fick plats.
    expect(docs[0].text.startsWith("B")).toBe(true);
  });
});

describe("loadDocuments", () => {
  it("ger tomt bibliotek för trasig JSON", () => {
    const store = makeStore();
    store.setItem(STORAGE_KEY, "{ inte json");
    expect(loadDocuments(store)).toEqual([]);
  });

  it("filtrerar bort poster som inte är dokument", () => {
    const store = makeStore();
    store.setItem(STORAGE_KEY, JSON.stringify([{ id: "x" }, null, 42]));
    expect(loadDocuments(store)).toEqual([]);
  });

  it("ger tomt bibliotek när lagringen inte går att läsa", () => {
    const blocked: DocumentStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(loadDocuments(blocked)).toEqual([]);
  });
});

describe("saveProgress", () => {
  it("sparar positionen", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Hej på dig.", source: "paste" });
    saveProgress(store, document.id, 4);
    expect(loadDocuments(store)[0].progress).toBe(4);
  });

  it("klampar positionen till textens längd", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Kort.", source: "paste" });
    saveProgress(store, document.id, 999);
    expect(loadDocuments(store)[0].progress).toBe(5);
  });

  it("rör inte sorteringen — att lyssna färdigt ska inte flytta om biblioteket", () => {
    const store = makeStore();
    const { document: first } = addDocument(store, { text: "Ett.", source: "paste" });
    addDocument(store, { text: "Två.", source: "paste" });
    const after = saveProgress(store, first.id, 3);
    expect(after[0].text).toBe("Två.");
  });

  it("gör ingenting för okänt id", () => {
    const store = makeStore();
    addDocument(store, { text: "Ett.", source: "paste" });
    expect(saveProgress(store, "finns-inte", 2)[0].progress).toBe(0);
  });
});

describe("deleteDocument och renameDocument", () => {
  it("tar bort rätt dokument", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Ett.", source: "paste" });
    addDocument(store, { text: "Två.", source: "paste" });
    expect(deleteDocument(store, document.id).map((d) => d.text)).toEqual(["Två."]);
  });

  it("byter namn", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "Ett.", source: "paste" });
    expect(renameDocument(store, document.id, " Nytt namn ")[0].title).toBe("Nytt namn");
  });

  it("ignorerar tomt namn", () => {
    const store = makeStore();
    const { document } = addDocument(store, { title: "Original", text: "Ett.", source: "paste" });
    expect(renameDocument(store, document.id, "   ")[0].title).toBe("Original");
  });
});

describe("titleFromText", () => {
  it("faller tillbaka när texten saknar innehåll", () => {
    expect(titleFromText("  \n ", "Namnlöst")).toBe("Namnlöst");
  });

  it("kortar långa rubriker", () => {
    const title = titleFromText("x".repeat(200), "Namnlöst");
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("progressRatio", () => {
  it("räknar andel läst", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "0123456789", source: "paste" });
    expect(progressRatio({ ...document, progress: 5 })).toBe(0.5);
  });

  it("räknar tomt dokument som oläst", () => {
    const store = makeStore();
    const { document } = addDocument(store, { text: "", source: "paste" });
    expect(progressRatio(document)).toBe(0);
  });
});
