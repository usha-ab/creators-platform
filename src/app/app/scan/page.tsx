"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Camera, CameraOff, CheckCircle, XCircle, Search, AlertCircle, UserCheck, Loader2, Lock, ImagePlus } from "lucide-react";
import { vibrate } from "@/lib/haptics";
import { useRole } from "@/components/mobile/role-context";
import { useSubscription } from "@/lib/subscription/context";

interface TicketResult {
  valid: boolean;
  status: string;
  bookingId: string;
  attendeeId?: string | null;
  attendeeLabel?: string | null;
  ticket: {
    code: string;
    title: string;
    date: string;
    time: string | null;
    location: string | null;
    ticketType?: string | null;
    holder?: string | null;
    seats?: number;
  };
}

interface CheckInResult {
  success: boolean;
  alreadyCheckedIn?: boolean;
  checkedInAt?: string;
  title?: string;
  error?: string;
  status?: string;
  attendeeLabel?: string;
  passRemaining?: number;
}

export default function ScanPage() {
  const { role } = useRole();
  const { tier, hasActiveSubscription } = useSubscription();
  const t = useTranslations("scanPage");

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [result, setResult] = useState<TicketResult | null>(null);
  const [checkInDone, setCheckInDone] = useState<CheckInResult | null>(null);
  const [error, setError] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [cameraErrorDetail, setCameraErrorDetail] = useState("");
  const [scanningFile, setScanningFile] = useState(false);
  const [delegated, setDelegated] = useState<boolean | null>(null);
  const scannerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  // Crew members the host delegated scanning to may also use the scanner.
  useEffect(() => {
    let active = true;
    fetch("/api/tickets/can-scan")
      .then((r) => r.json())
      .then((d) => active && setDelegated(!!d.allowed))
      .catch(() => active && setDelegated(false));
    return () => {
      active = false;
    };
  }, []);

  // Scanning is for: venues (any tier), creators on Gold/Premium (scanning is a
  // paid creator feature), and crew the host delegated scanning to (can_scan —
  // volunteers/team). Not attendees.
  // Scanning requires a paid account for EVERYONE — creators, venues AND
  // delegated crew (volunteers/team). During the free beta, hasActiveSubscription
  // is true for all, so scanning is open to authorized users until beta ends.
  const paid = tier === "guld" || tier === "premium" || hasActiveSubscription;
  const authorized = role === "creator" || role === "venue" || delegated === true;
  const hasAccess = paid && authorized;

  // Wait for the delegation check before deciding, for non-host roles.
  const isHostRole = role === "creator" || role === "venue";
  if (!isHostRole && delegated === null) {
    return (
      <div className="flex items-center justify-center px-4 py-24 text-[var(--usha-muted)]">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (!hasAccess) {
    // Authorized (host/crew) but on a free account → can unlock by upgrading.
    // Not authorized (attendee) → upgrading won't help; show the role message.
    const needsUpgrade = authorized && !paid;
    return (
      <div className="px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-sm text-[var(--usha-muted)]">{t("subtitle")}</p>
        </div>
        <div className="rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] p-8 text-center">
          <Lock size={28} className="mx-auto mb-3 text-[var(--usha-muted)]" />
          <p className="text-sm text-[var(--usha-muted)]">
            {needsUpgrade ? t("gateMessage") : t("gateRoleOnly")}
          </p>
          {needsUpgrade && (
            <a
              href="/dashboard/billing"
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
            >
              {t("upgradeCta")}
            </a>
          )}
        </div>
      </div>
    );
  }

  // Start QR scanner
  function isPermissionError(err: unknown): boolean {
    const info = `${(err as { name?: string })?.name ?? ""} ${String((err as { message?: string })?.message ?? err ?? "")}`;
    return /NotAllowed|Permission|denied|dismissed|SecurityError/i.test(info);
  }

  async function startScanner() {
    if (scannerRef.current) return;

    setScannerLoading(true);
    setError("");
    setCameraBlocked(false);
    setCameraErrorDetail("");

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    const onScan = (decodedText: string) => {
      handleQrResult(decodedText);
      stopScanner();
    };
    const onFrameErr = () => {
      // Ignore frames without a QR code
    };

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      // Prefer the rear camera, but some devices reject the facingMode
      // constraint — fall back to any available camera before giving up.
      try {
        await scanner.start({ facingMode: "environment" }, config, onScan, onFrameErr);
      } catch (e1) {
        if (isPermissionError(e1)) throw e1;
        try {
          await scanner.start({ facingMode: "user" }, config, onScan, onFrameErr);
        } catch (e2) {
          if (isPermissionError(e2)) throw e2;
          const cameras = await Html5Qrcode.getCameras();
          if (cameras && cameras.length > 0) {
            await scanner.start(cameras[0].id, config, onScan, onFrameErr);
          } else {
            throw e2;
          }
        }
      }
      setScannerActive(true);
    } catch (err) {
      console.error("Scanner start failed:", err);
      scannerRef.current = null;
      const detail = `${(err as { name?: string })?.name ?? "Error"}: ${String((err as { message?: string })?.message ?? err ?? "")}`.slice(0, 160);
      setCameraErrorDetail(detail);
      if (isPermissionError(err)) {
        setCameraBlocked(true);
      } else {
        setError(t("errCouldNotStartCamera"));
      }
    } finally {
      setScannerLoading(false);
    }
  }

  function stopScanner() {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setScannerActive(false);
  }

  // Photo fallback: scan a QR from a photo taken with the phone's native camera
  // app. This uses the camera app's own permission, so it works even when the
  // browser's getUserMedia camera is blocked.
  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;

    setScanningFile(true);
    setError("");
    setCameraBlocked(false);
    setCameraErrorDetail("");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const fileScanner = new Html5Qrcode("qr-file-reader");
      const decoded = await fileScanner.scanFile(file, false);
      handleQrResult(decoded);
    } catch {
      setError(t("errNoQrInImage"));
    } finally {
      setScanningFile(false);
    }
  }

  // Parse QR result — could be a URL or direct code
  function handleQrResult(text: string) {
    vibrate();

    // Try URL format: .../api/tickets/verify?code=USH-XXXXXXXX&id=...&att=...
    const urlMatch = text.match(/code=(USH-[A-Fa-f0-9]{8})/i);
    if (urlMatch) {
      const attMatch = text.match(/[?&]att=([0-9a-f-]{36})/i);
      verifyCode(urlMatch[1].toUpperCase(), attMatch?.[1]);
      return;
    }

    // Try direct code format: USH-XXXXXXXX
    const codeMatch = text.match(/^USH-([A-Fa-f0-9]{8})$/i);
    if (codeMatch) {
      verifyCode(text.toUpperCase());
      return;
    }

    setError(t("errCouldNotParseQr"));
  }

  async function verifyCode(ticketCode: string, att?: string) {
    setError("");
    setResult(null);
    setCheckInDone(null);
    setLoading(true);
    setCode(ticketCode);

    const match = ticketCode.match(/^USH-([A-Fa-f0-9]{8})$/i);
    if (!match) {
      setError(t("errInvalidFormat"));
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/tickets/verify?code=${encodeURIComponent(ticketCode)}&id=${match[1]}${att ? `&att=${att}` : ""}`
      );
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setError(t("errOnlyOwnEvents"));
        } else {
          setError(data.error || t("errCouldNotVerify"));
        }
      } else {
        setResult(data);
      }
    } catch {
      setError(t("errNetwork"));
    }
    setLoading(false);
  }

  async function handleCheckIn() {
    if (!result?.bookingId) return;

    setCheckingIn(true);
    try {
      const res = await fetch("/api/tickets/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: result.bookingId, attendeeId: result.attendeeId ?? undefined }),
      });
      const data: CheckInResult = await res.json();
      if (data.success) vibrate([50, 30, 50]);
      setCheckInDone(data);
    } catch {
      setCheckInDone({ success: false, error: t("errNetworkShort") });
    }
    setCheckingIn(false);
  }

  function handleManualVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) verifyCode(trimmed);
  }

  function resetScan() {
    setResult(null);
    setCheckInDone(null);
    setError("");
    setCode("");
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--usha-muted)]">
          Skanna QR-koden eller ange biljettkoden manuellt.
        </p>
      </div>

      {/* QR Scanner */}
      {!result && !checkInDone && (
        <>
          <div className="mb-4 overflow-hidden rounded-xl border border-[var(--usha-border)] bg-black">
            <div id="qr-reader" ref={scannerContainerRef} className="w-full" />
            {!scannerActive && !cameraBlocked && (
              <button
                onClick={startScanner}
                disabled={scannerLoading}
                className="flex w-full items-center justify-center gap-2 bg-[var(--usha-card)] py-12 text-sm text-[var(--usha-muted)] transition hover:text-[var(--usha-white)] disabled:opacity-50"
              >
                {scannerLoading ? (
                  <>
                    <Loader2 size={24} className="animate-spin" />
                    <span>{t("startingCamera")}</span>
                  </>
                ) : (
                  <>
                    <Camera size={24} />
                    <span>{t("tapToStart")}</span>
                  </>
                )}
              </button>
            )}
            {!scannerActive && cameraBlocked && (
              <div className="bg-[var(--usha-card)] p-6 text-center">
                <CameraOff size={28} className="mx-auto mb-2 text-amber-400" />
                <p className="font-semibold text-[var(--usha-white)]">{t("cameraBlocked")}</p>
                <p className="mt-1 text-sm text-[var(--usha-muted)]">
                  {t("allowCameraHint")}
                </p>
                <button
                  onClick={startScanner}
                  disabled={scannerLoading}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-6 py-2.5 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
                >
                  {scannerLoading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                  {t("allowRetry")}
                </button>
                <div className="mt-5 space-y-1.5 text-left text-xs text-[var(--usha-muted)]">
                  <p className="font-semibold text-[var(--usha-white)]">{t("manualHelpTitle")}</p>
                  <p>• {t("manualHelpIphone")}</p>
                  <p>• {t("manualHelpAndroid")}</p>
                  <p>• {t("manualHelpDenied")}</p>
                  <p>• {t("manualHelpInstalled")}</p>
                </div>
                {cameraErrorDetail && (
                  <p className="mt-4 break-words rounded-lg bg-[var(--usha-black)] px-3 py-2 text-left font-mono text-[10px] text-[var(--usha-muted)]">
                    {t("technicalReason", { detail: cameraErrorDetail })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Photo fallback — uses the native camera app (own permission) */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={scanningFile}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] py-3 text-sm font-medium text-[var(--usha-white)] transition hover:border-[var(--usha-gold)]/50 disabled:opacity-50"
          >
            {scanningFile ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
            {scanningFile ? t("readingImage") : t("photoFallback")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFilePick}
            className="hidden"
          />
          <div id="qr-file-reader" className="hidden" />

          {/* Divider */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1 border-t border-[var(--usha-border)]" />
            <span className="text-xs text-[var(--usha-muted)]">{t("orEnterCode")}</span>
            <div className="flex-1 border-t border-[var(--usha-border)]" />
          </div>

          {/* Manual code entry */}
          <form onSubmit={handleManualVerify} className="mb-6">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--usha-muted)]"
                />
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="USH-A1B2C3D4"
                  className="w-full rounded-xl border border-[var(--usha-border)] bg-[var(--usha-card)] py-3 pl-10 pr-4 font-mono text-sm uppercase outline-none transition focus:border-[var(--usha-gold)]/40"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--usha-gold)] to-[var(--usha-accent)] px-5 py-3 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              </button>
            </div>
          </form>
        </>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-center">
          <XCircle size={32} className="mx-auto mb-2 text-red-400" />
          <p className="font-semibold text-red-400">{t("errorTitle")}</p>
          <p className="mt-1 text-sm text-[var(--usha-muted)]">{error}</p>
          {cameraErrorDetail && (
            <p className="mt-2 break-words font-mono text-[10px] text-[var(--usha-muted)]">
              {t("technicalReason", { detail: cameraErrorDetail })}
            </p>
          )}
          <button
            onClick={() => { setError(""); resetScan(); }}
            className="mt-3 rounded-xl border border-[var(--usha-border)] px-6 py-2 text-sm transition hover:bg-[var(--usha-card)]"
          >
            {t("tryAgain")}
          </button>
        </div>
      )}

      {/* Verify Result (before check-in) */}
      {result && !checkInDone && (
        <div
          className={`rounded-xl border p-6 text-center ${
            result.valid
              ? "border-green-500/20 bg-green-500/10"
              : "border-red-500/20 bg-red-500/10"
          }`}
        >
          {result.valid ? (
            <>
              <CheckCircle size={48} className="mx-auto mb-3 text-green-400" />
              <p className="text-lg font-bold text-green-400">{t("validTicket")}</p>
            </>
          ) : (
            <>
              <XCircle size={48} className="mx-auto mb-3 text-red-400" />
              <p className="text-lg font-bold text-red-400">
                {result.status === "already_used" ? t("statusAlreadyUsed") :
                 result.status === "canceled" ? t("statusCanceled") :
                 result.status === "pending" ? t("statusPending") :
                 result.status === "wrong_date" ? t("statusWrongDate", { date: result.ticket.date }) :
                 t("statusInvalid")}
              </p>
            </>
          )}

          {/* Biljettypen först och störst. Det är den enda raden som avgör
              om personen ska in nu eller först kl. 20 — allt annat på kortet
              är samma för hela kvällen. */}
          {result.ticket.ticketType && (
            <p className="mt-3 text-2xl font-bold text-[var(--usha-gold)]">{result.ticket.ticketType}</p>
          )}
          {(result.ticket.holder || (result.ticket.seats ?? 1) > 1) && (
            <p className="mt-1 text-sm text-[var(--usha-white)]">
              {result.ticket.holder}
              {(result.ticket.seats ?? 1) > 1 && (
                <span className="text-[var(--usha-muted)]">
                  {result.ticket.holder ? " · " : ""}
                  {t("seats", { n: result.ticket.seats ?? 1 })}
                </span>
              )}
            </p>
          )}

          <div className="mt-4 space-y-1 text-sm">
            <p className="font-semibold">{result.ticket.title}</p>
            {result.attendeeLabel && (
              <p className="inline-block rounded-full bg-[var(--usha-gold)]/15 px-2.5 py-0.5 text-xs font-medium text-[var(--usha-gold)]">
                {result.attendeeLabel}
              </p>
            )}
            <p className="text-[var(--usha-muted)]">
              <span className="font-mono">{result.ticket.code}</span>
            </p>
            <p className="text-[var(--usha-muted)]">
              {result.ticket.date}
              {result.ticket.time && ` · ${result.ticket.time}`}
            </p>
            {result.ticket.location && (
              <p className="text-[var(--usha-muted)]">{result.ticket.location}</p>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-2">
            {result.valid && (
              <button
                onClick={handleCheckIn}
                disabled={checkingIn}
                className="flex items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-3 text-sm font-bold text-white transition hover:bg-green-600 disabled:opacity-50"
              >
                {checkingIn ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <UserCheck size={16} />
                )}
                {t("checkInButton")}
              </button>
            )}
            <button
              onClick={resetScan}
              className="rounded-xl border border-[var(--usha-border)] px-6 py-2 text-sm transition hover:bg-[var(--usha-card)]"
            >
              {t("scanNext")}
            </button>
          </div>
        </div>
      )}

      {/* Check-in Result */}
      {checkInDone && (
        <div
          className={`rounded-xl border p-6 text-center ${
            checkInDone.success
              ? "border-green-500/20 bg-green-500/10"
              : checkInDone.alreadyCheckedIn
                ? "border-yellow-500/20 bg-yellow-500/10"
                : "border-red-500/20 bg-red-500/10"
          }`}
        >
          {checkInDone.success ? (
            <>
              <UserCheck size={48} className="mx-auto mb-3 text-green-400" />
              <p className="text-lg font-bold text-green-400">{t("checkedInSuccess")}</p>
              <p className="mt-2 text-sm font-medium">{checkInDone.title}</p>
              {checkInDone.passRemaining != null && (
                <p className="mt-1 text-sm font-semibold text-[var(--usha-gold)]">{t("passRemaining", { n: checkInDone.passRemaining })}</p>
              )}
              <p className="mt-1 text-xs text-[var(--usha-muted)]">
                {new Date(checkInDone.checkedInAt!).toLocaleTimeString("sv-SE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </>
          ) : checkInDone.alreadyCheckedIn ? (
            <>
              <AlertCircle size={48} className="mx-auto mb-3 text-yellow-400" />
              <p className="text-lg font-bold text-yellow-400">{t("statusAlreadyUsed")}</p>
              <p className="mt-2 text-sm font-medium">{checkInDone.title}</p>
              <p className="mt-1 text-xs text-[var(--usha-muted)]">
                {t("checkInTimeLabel", {
                  time: new Date(checkInDone.checkedInAt!).toLocaleTimeString("sv-SE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </p>
            </>
          ) : (
            <>
              <XCircle size={48} className="mx-auto mb-3 text-red-400" />
              <p className="text-lg font-bold text-red-400">{t("checkInFailed")}</p>
              <p className="mt-2 text-sm text-[var(--usha-muted)]">
                {checkInDone.error}
              </p>
            </>
          )}

          <button
            onClick={resetScan}
            className="mt-6 rounded-xl border border-[var(--usha-border)] px-6 py-3 text-sm font-medium transition hover:bg-[var(--usha-card)]"
          >
            {t("scanNextTicket")}
          </button>
        </div>
      )}
    </div>
  );
}
