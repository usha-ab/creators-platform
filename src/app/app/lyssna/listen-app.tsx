"use client";

// Uppläsaren: lägg in en text, lyssna på den, hitta tillbaka till den.
//
// Texterna sparas i webbläsaren och lämnar aldrig enheten. Undantaget är
// artikelimporten, där servern måste hämta sidan åt oss eftersom CORS
// stoppar webbläsaren.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ClipboardPaste,
  FileText,
  Headphones,
  Link2,
  Loader2,
  Play,
  Trash2,
  Upload,
} from "lucide-react";
import {
  addDocument,
  deleteDocument,
  loadDocuments,
  progressRatio,
  saveProgress,
  type ListenDocument,
} from "@/lib/tts/library";
import { countWords, estimateSeconds, formatDuration } from "@/lib/tts/segment";
import { Reader } from "./reader";

type Tab = "paste" | "file" | "url";

/** Textfiler vi kan läsa direkt i webbläsaren utan tolkningslager. */
const ACCEPTED_FILES = ".txt,.md,.markdown,.csv,.json,text/plain,text/markdown";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function ListenApp() {
  const t = useTranslations("listen");
  const [documents, setDocuments] = useState<ListenDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("paste");
  const [pasted, setPasted] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Biblioteket finns bara i webbläsaren, så det läses efter montering.
  useEffect(() => {
    setDocuments(loadDocuments(window.localStorage));
    setReady(true);
  }, []);

  const active = useMemo(
    () => documents.find((d) => d.id === activeId) ?? null,
    [documents, activeId]
  );

  const handleProgress = useCallback((offset: number) => {
    if (!activeId) return;
    setDocuments(saveProgress(window.localStorage, activeId, offset));
  }, [activeId]);

  const add = useCallback(
    (input: { title?: string; text: string; source: Tab; url?: string }) => {
      const text = input.text.trim();
      if (text.length === 0) {
        setError(t("errorEmpty"));
        return;
      }
      const { documents: next, document } = addDocument(
        window.localStorage,
        { ...input, text },
        t("untitled")
      );
      setDocuments(next);
      setActiveId(document.id);
      setError(null);
      setPasted("");
      setUrl("");
    },
    [t]
  );

  const importUrl = useCallback(async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await response.json()) as { title?: string; text?: string; url?: string; error?: string };
      if (!response.ok || !data.text) {
        setError(data.error ?? t("errorImport"));
        return;
      }
      add({ title: data.title, text: data.text, source: "url", url: data.url });
    } catch {
      setError(t("errorImport"));
    } finally {
      setBusy(false);
    }
  }, [url, add, t]);

  const importFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        setError(t("errorFileSize"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const text = await file.text();
        add({ title: file.name.replace(/\.[^.]+$/, ""), text, source: "file" });
      } catch {
        setError(t("errorFileRead"));
      } finally {
        setBusy(false);
      }
    },
    [add, t]
  );

  if (active) {
    return (
      <Reader
        document={active}
        onProgress={handleProgress}
        onClose={() => setActiveId(null)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header>
        <div className="mb-1 flex items-center gap-2">
          <Headphones size={22} className="text-[var(--usha-gold)]" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <p className="text-sm text-[var(--usha-muted)]">{t("subtitle")}</p>
      </header>

      <section className="rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-4">
        <div className="mb-3 flex gap-1 rounded-xl bg-[var(--usha-black)] p-1">
          {([
            ["paste", ClipboardPaste, t("tabPaste")],
            ["file", Upload, t("tabFile")],
            ["url", Link2, t("tabUrl")],
          ] as const).map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setError(null);
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${
                tab === key
                  ? "bg-[var(--usha-gold)] font-semibold text-[var(--usha-black)]"
                  : "text-[var(--usha-muted)] hover:text-[var(--usha-white)]"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {tab === "paste" && (
          <div className="space-y-3">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              placeholder={t("pastePlaceholder")}
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] p-3 text-sm text-[var(--usha-white)] outline-none focus:border-[var(--usha-gold)]"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--usha-muted)]">
                {t("wordCount", {
                  words: countWords(pasted),
                  duration: formatDuration(estimateSeconds(countWords(pasted))),
                })}
              </span>
              <button
                onClick={() => add({ text: pasted, source: "paste" })}
                disabled={pasted.trim().length === 0}
                className="rounded-xl bg-[var(--usha-gold)] px-4 py-2 text-sm font-semibold text-[var(--usha-black)] transition hover:opacity-90 disabled:opacity-40"
              >
                {t("listenAction")}
              </button>
            </div>
          </div>
        )}

        {tab === "file" && (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--usha-border)] p-6 text-center transition hover:border-[var(--usha-gold)]/60">
              <Upload size={22} className="text-[var(--usha-gold)]" />
              <span className="text-sm font-medium">{t("fileCta")}</span>
              <span className="text-xs text-[var(--usha-muted)]">{t("fileHint")}</span>
              <input
                type="file"
                accept={ACCEPTED_FILES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Nollställ så att samma fil kan väljas igen efter ett fel.
                  e.target.value = "";
                  if (file) void importFile(file);
                }}
              />
            </label>
          </div>
        )}

        {tab === "url" && (
          <div className="space-y-3">
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void importUrl();
              }}
              placeholder="https://…"
              className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-black)] p-3 text-sm text-[var(--usha-white)] outline-none focus:border-[var(--usha-gold)]"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--usha-muted)]">{t("urlHint")}</span>
              <button
                onClick={() => void importUrl()}
                disabled={busy || url.trim().length === 0}
                className="flex items-center gap-2 rounded-xl bg-[var(--usha-gold)] px-4 py-2 text-sm font-semibold text-[var(--usha-black)] transition hover:opacity-90 disabled:opacity-40"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {t("importAction")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-[var(--usha-accent)]/10 px-3 py-2 text-sm text-[var(--usha-accent)]">
            {error}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--usha-muted)]">
          {t("libraryHeading")}
        </h2>

        {!ready ? (
          <p className="text-sm text-[var(--usha-muted)]">{t("loading")}</p>
        ) : documents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--usha-border)] p-6 text-center">
            <FileText size={22} className="mx-auto mb-2 text-[var(--usha-muted)]" />
            <p className="text-sm text-[var(--usha-muted)]">{t("libraryEmpty")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => {
              const words = countWords(doc.text);
              const percent = Math.round(progressRatio(doc) * 100);
              return (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-3"
                >
                  <button
                    onClick={() => setActiveId(doc.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--usha-gold)]/10 text-[var(--usha-gold)]">
                      <Play size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{doc.title}</span>
                      <span className="block text-xs text-[var(--usha-muted)]">
                        {t("wordCount", { words, duration: formatDuration(estimateSeconds(words)) })}
                        {percent > 0 && ` · ${t("progress", { percent })}`}
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={t("delete")}
                    onClick={() => {
                      if (!window.confirm(t("deleteConfirm", { title: doc.title }))) return;
                      setDocuments(deleteDocument(window.localStorage, doc.id));
                    }}
                    className="rounded-lg p-2 text-[var(--usha-muted)] transition hover:text-[var(--usha-accent)]"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 text-xs text-[var(--usha-muted)]">{t("privacyNote")}</p>
      </section>
    </div>
  );
}
