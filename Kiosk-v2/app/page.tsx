"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Screen =
  | "home"
  | "reading"
  | "success"
  | "pid"
  | "not-found"
  | "unknown-card"
  | "waiver-required"
  | "backend-error"
  | "link-card"
  | "link-authorize"
  | "link-error"
  | "card-linked"
  | "reader-error"
  | "profile"
  | "profile-detail"
  | "new-here";

type Announcement = {
  active: boolean;
  heading: string;
  body: string;
  closingTime: string;
};

const REGISTRATION_URL = process.env.NEXT_PUBLIC_REGISTRATION_URL?.trim() || "";

type ScannerStatus = "demo" | "connecting" | "connected" | "disconnected";

type ScannerOutcome =
  | "demo"
  | "success"
  | "unknown_card"
  | "unknown_identifier"
  | "waiver_required"
  | "backend_error"
  | "card_linked"
  | "staff_unauthorized"
  | "card_link_error";

type ScannerDetectedEvent = {
  type: "card_detected";
  read_at: string;
  sequence: number;
};

type ScannerResultEvent = {
  type: "card_read";
  outcome: ScannerOutcome;
  display_name: string | null;
  message: string;
  visit_count: number | null;
  read_at: string;
  sequence: number;
  processing_ms?: number;
};

type ScannerEvent = ScannerDetectedEvent | ScannerResultEvent;

const emptyAnnouncement: Announcement = {
  active: false,
  heading: "CHECK IN WITH STAFF",
  body: "Please check in with me upstairs before starting work.",
  closingTime: "",
};

const affiliations = [
  "Undergraduate",
  "Graduate student",
  "Postdoc",
  "Faculty",
  "Staff",
  "Visitor",
];

function Arrow({ direction = "right" }: { direction?: "right" | "left" }) {
  return <span aria-hidden="true">{direction === "right" ? "→" : "←"}</span>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [demoOpen, setDemoOpen] = useState(false);
  const [pid, setPid] = useState("");
  const [checkInMethod, setCheckInMethod] = useState<"card" | "identifier">("card");
  const [affiliation, setAffiliation] = useState("");
  const [detail, setDetail] = useState("");
  const [linkIdentifier, setLinkIdentifier] = useState("");
  const [linkTargetName, setLinkTargetName] = useState("Sandbox member");
  const [linkError, setLinkError] = useState("");
  const [staffCardDetected, setStaffCardDetected] = useState(false);
  const [countdown, setCountdown] = useState(8);
  const [now, setNow] = useState<Date | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>(emptyAnnouncement);
  const [announcementDraft, setAnnouncementDraft] = useState<Announcement>(emptyAnnouncement);
  const [staffOpen, setStaffOpen] = useState(false);
  const [demoClosingMinutes, setDemoClosingMinutes] = useState<number | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>("demo");
  const [scannerResult, setScannerResult] = useState<ScannerResultEvent | null>(null);
  const [welcomeName, setWelcomeName] = useState("Sandbox member");
  const [visitCount, setVisitCount] = useState<number | null>(null);
  const demoControlsEnabled = process.env.NEXT_PUBLIC_KIOSK_DEMO === "true";
  const screenRef = useRef<Screen>("home");
  const cardDetectedAtRef = useRef<number | null>(null);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    setNow(new Date());
    const saved = window.localStorage.getItem("sandbox-kiosk-announcement");
    if (saved) {
      try {
        const parsed = { ...emptyAnnouncement, ...JSON.parse(saved) };
        setAnnouncement(parsed);
        setAnnouncementDraft(parsed);
      } catch {
        window.localStorage.removeItem("sandbox-kiosk-announcement");
      }
    }
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const configuredUrl = process.env.NEXT_PUBLIC_SCANNER_WS_URL?.trim();
    const isLocalKiosk = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const scannerUrl = configuredUrl || (isLocalKiosk ? "ws://127.0.0.1:8765/ws" : "");

    if (!scannerUrl) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;
      setScannerStatus("connecting");
      socket = new WebSocket(scannerUrl);

      socket.addEventListener("open", () => setScannerStatus("connected"));
      socket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(message.data) as ScannerEvent;
          if (event.type === "card_detected" && screenRef.current === "home") {
            cardDetectedAtRef.current = performance.now();
            setScannerResult(null);
            setCheckInMethod("card");
            setScreen("reading");
          } else if (event.type === "card_detected" && screenRef.current === "link-authorize") {
            setStaffCardDetected(true);
          } else if (
            event.type === "card_read" &&
            (screenRef.current === "home" || screenRef.current === "reading")
          ) {
            if (screenRef.current === "home") {
              cardDetectedAtRef.current = performance.now();
              setCheckInMethod("card");
              setScreen("reading");
            }
            setScannerResult(event);
          } else if (event.type === "card_read" && screenRef.current === "link-authorize") {
            setStaffCardDetected(false);
            if (event.outcome === "card_linked") {
              setWelcomeName(event.display_name || "Sandbox member");
              setScreen("card-linked");
            } else {
              setLinkError(event.message || "That staff card could not authorize the link.");
              setScreen("link-error");
            }
          }
        } catch {
          // Ignore malformed local bridge messages; the bridge will keep listening.
        }
      });
      socket.addEventListener("close", () => {
        if (stopped) return;
        setScannerStatus("disconnected");
        reconnectTimer = window.setTimeout(connect, 3_000);
      });
      socket.addEventListener("error", () => socket?.close());
    }

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    if (screen !== "reading" || !scannerResult) return;
    const detectedAt = cardDetectedAtRef.current ?? performance.now();
    const minimumFeedbackMs = 500;
    const delay = Math.max(0, minimumFeedbackMs - (performance.now() - detectedAt));
    const timer = window.setTimeout(() => {
      if (scannerResult.outcome === "demo") {
        setScreen("success");
        return;
      }
      if (scannerResult.outcome === "success") {
        setWelcomeName(scannerResult.display_name || "Sandbox member");
        setVisitCount(scannerResult.visit_count);
        setScreen("success");
      } else if (scannerResult.outcome === "unknown_card") {
        setScreen("unknown-card");
    } else if (scannerResult.outcome === "unknown_identifier") {
      setScreen("not-found");
      } else if (scannerResult.outcome === "waiver_required") {
        setScreen("waiver-required");
      } else {
        setScreen("backend-error");
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [screen, scannerResult]);

  useEffect(() => {
    if (screen !== "success") return;
    setCountdown(8);
    const interval = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(interval);
          setScreen("home");
          return 8;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [screen]);

  const timeLabel = useMemo(
    () =>
      now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) ?? "",
    [now],
  );

  const minutesUntilClose = useMemo(() => {
    if (demoClosingMinutes !== null) return demoClosingMinutes;
    if (!now || !announcement.closingTime) return null;
    const [hours, minutes] = announcement.closingTime.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    const closes = new Date(now);
    closes.setHours(hours, minutes, 0, 0);
    const difference = Math.ceil((closes.getTime() - now.getTime()) / 60_000);
    return difference >= 0 && difference <= 30 ? difference : null;
  }, [announcement.closingTime, demoClosingMinutes, now]);

  const closingLabel = minutesUntilClose === 0
    ? "We’re closing now"
    : minutesUntilClose !== null
      ? `We close in ${minutesUntilClose} minute${minutesUntilClose === 1 ? "" : "s"}`
      : "";

  function openStaffEditor() {
    setAnnouncementDraft(announcement);
    setDemoOpen(false);
    setStaffOpen(true);
  }

  function saveAnnouncement(event: FormEvent) {
    event.preventDefault();
    const next = {
      ...announcementDraft,
      heading: announcementDraft.heading.trim() || emptyAnnouncement.heading,
      body: announcementDraft.body.trim() || emptyAnnouncement.body,
    };
    setAnnouncement(next);
    window.localStorage.setItem("sandbox-kiosk-announcement", JSON.stringify(next));
    setStaffOpen(false);
    setScreen("home");
  }

  function clearAnnouncement() {
    const next = { ...announcement, active: false };
    setAnnouncement(next);
    setAnnouncementDraft(next);
    window.localStorage.setItem("sandbox-kiosk-announcement", JSON.stringify(next));
  }

  function startDemoCheckIn() {
    cardDetectedAtRef.current = performance.now();
    setScannerResult({
      type: "card_read",
      outcome: "demo",
      display_name: "Sandbox member",
      message: "Demo read accepted.",
      visit_count: null,
      read_at: new Date().toISOString(),
      sequence: 0,
    });
    setWelcomeName("Sandbox member");
    setVisitCount(null);
    setCheckInMethod("card");
    setScreen("reading");
  }

  function reset() {
    cardDetectedAtRef.current = null;
    setScannerResult(null);
    setWelcomeName("Sandbox member");
    setVisitCount(null);
    setScreen("home");
    setCheckInMethod("card");
    setPid("");
    setAffiliation("");
    setDetail("");
    setLinkIdentifier("");
    setLinkTargetName("Sandbox member");
    setLinkError("");
    setStaffCardDetected(false);
    setDemoOpen(false);
  }

  async function submitPid(event: FormEvent) {
    event.preventDefault();
    const normalized = pid.trim().toUpperCase();
    if (!normalized) return;

    cardDetectedAtRef.current = performance.now();
    setScannerResult(null);
    setCheckInMethod("identifier");
    setScreen("reading");
    setPid("");
    try {
      const response = await fetch("http://127.0.0.1:8765/check-in/identifier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: normalized }),
      });
      if (!response.ok) throw new Error("Identifier check-in failed");
      const result = await response.json() as ScannerResultEvent;
      setScannerResult(result);
    } catch {
      setScannerResult({
        type: "card_read",
        outcome: "backend_error",
        display_name: null,
        message: "The check-in could not be recorded. Please see staff.",
        visit_count: null,
        read_at: new Date().toISOString(),
        sequence: 0,
      });
    }
  }

  async function startCardLink(event: FormEvent) {
    event.preventDefault();
    const identifier = linkIdentifier.trim().toUpperCase();
    if (!identifier) return;
    setLinkError("");
    try {
      const response = await fetch("http://127.0.0.1:8765/card-link/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const result = await response.json() as {
        ok?: boolean;
        display_name?: string;
        message?: string;
        detail?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.message || result.detail || "The card-link session could not start.");
      }
      setLinkTargetName(result.display_name || "Sandbox member");
      setStaffCardDetected(false);
      setScreen("link-authorize");
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "The card-link session could not start.");
      setScreen("link-card");
    }
  }

  async function cancelCardLink() {
    try {
      await fetch("http://127.0.0.1:8765/card-link/cancel", { method: "POST" });
    } catch {
      // The bridge also expires pending card data automatically.
    }
    reset();
  }

  const showBrand = screen !== "success";

  return (
    <main className={`kiosk screen-${screen}`}>
      <header className="utility-bar">
        <button className="mini-brand" onClick={reset} aria-label="Return home">
          SCRIPPS SANDBOX <span>MAKERSPACE</span>
        </button>
        <div className="utility-right">
          <span className="clock" aria-label="Current time">{timeLabel}</span>
          <button className="staff-toggle" onClick={openStaffEditor}>STAFF</button>
          {demoControlsEnabled && <button
            className={`demo-toggle ${demoOpen ? "active" : ""}`}
            onClick={() => setDemoOpen((open) => !open)}
            aria-expanded={demoOpen}
          >
            DEMO
          </button>}
        </div>
      </header>

      {showBrand && (
        <section className="brand-plane" aria-label="Scripps Sandbox Makerspace">
          <button
            className="logo-tap-target"
            onClick={() => { if (demoControlsEnabled) startDemoCheckIn(); }}
            aria-label="Scripps Sandbox mark"
          >
            <img src="/assets/scripps-sandbox-mark.png" alt="Scripps Sandbox mark" />
            <span className="orange-tag">CHECK IN</span>
          </button>
        </section>
      )}

      <section className="interaction-plane" aria-live="polite">
        {screen === "home" && (
          <div className={`home-copy screen-content ${(announcement.active || minutesUntilClose !== null) ? "has-alert" : ""}`}>
            <p className="eyebrow">SCRIPPS SANDBOX MAKERSPACE</p>
            <h1>Tap your<br />UC San Diego ID.</h1>
            <p className="lede">Hold your card near the reader to check in.</p>
            {scannerStatus === "disconnected" && (
              <p className="reader-offline-notice" role="status">Card reader unavailable. Use your PID or employee ID below.</p>
            )}
            {(announcement.active || minutesUntilClose !== null) && (
              <div className="arrival-notices">
                {announcement.active && (
                  <article className="arrival-alert custom-alert">
                    <span className="alert-index" aria-hidden="true">!</span>
                    <div>
                      <p>{announcement.heading}</p>
                      <strong>{announcement.body}</strong>
                    </div>
                  </article>
                )}
                {minutesUntilClose !== null && (
                  <article className="arrival-alert closing-alert">
                    <span className="alert-index" aria-hidden="true">{String(minutesUntilClose).padStart(2, "0")}</span>
                    <div>
                      <p>CLOSING SOON</p>
                      <strong>{closingLabel}. Please plan your work accordingly.</strong>
                    </div>
                  </article>
                )}
              </div>
            )}
            <div className="primary-actions">
              <button className="text-action" onClick={() => setScreen("pid")}>
                <span><small>NO CARD?</small>Check in with PID or employee ID</span>
                <Arrow />
              </button>
              <button className="text-action" onClick={() => setScreen("new-here")}>
                <span><small>NEW HERE?</small>Get started</span>
                <Arrow />
              </button>
            </div>
            {demoControlsEnabled && <p className="tap-hint">For this mockup, tap the large Sandbox mark—or open <b>DEMO</b>.</p>}
          </div>
        )}

        {screen === "reading" && (
          <div className="status-content screen-content">
            <div className="signal" aria-hidden="true"><i /><i /><i /></div>
            <p className="eyebrow">
              {checkInMethod === "identifier" ? "ID SUBMITTED" : "CARD DETECTED"}
            </p>
            <h1>Checking<br />you in…</h1>
            <p className="lede">
              {checkInMethod === "identifier"
                ? "We found your ID. Please wait while we record your visit."
                : "Card detected. You can remove it while we record your visit."}
            </p>
          </div>
        )}

        {screen === "pid" && (
          <div className="form-content screen-content">
            <button className="back" onClick={() => setScreen("home")}><Arrow direction="left" /> Back</button>
            <p className="eyebrow">CHECK IN WITHOUT A CARD</p>
            <h1>Enter your ID.</h1>
            <p className="lede compact">Use your PID or UC San Diego employee ID.</p>
            <form onSubmit={submitPid}>
              <label htmlFor="pid">PID OR EMPLOYEE ID</label>
              <input
                id="pid"
                value={pid}
                onChange={(event) => setPid(event.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="A12345678"
              />
              <button className="solid-action" type="submit" disabled={!pid.trim()}>
                Check in <Arrow />
              </button>
            </form>
            {demoControlsEnabled && <p className="demo-note">Demo IDs: A12345678 or A87654321.</p>}
          </div>
        )}

        {screen === "not-found" && (
          <div className="status-content screen-content">
            <button className="back" onClick={() => setScreen("pid")}><Arrow direction="left" /> Back</button>
            <p className="eyebrow warning">WE COULDN’T FIND THAT ID</p>
            <h1>Check the number<br />and try again.</h1>
            <p className="lede">If this is your first visit, choose “Get started.”</p>
            <div className="button-row">
              <button className="solid-action" onClick={() => { setPid(""); setScreen("pid"); }}>Try again</button>
              <button className="outline-action" onClick={() => setScreen("new-here")}>Get started</button>
            </div>
          </div>
        )}

        {screen === "unknown-card" && (
          <div className="status-content screen-content">
            <p className="eyebrow warning">CARD NOT CONNECTED</p>
            <h1>We don’t know<br />this card yet.</h1>
            <p className="lede">Already registered? Designated staff can connect this card after checking your physical ID.</p>
          <div className="stacked-actions">
            <button className="solid-action" onClick={() => setScreen("link-card")}>Ask staff to connect this card <Arrow /></button>
            <button className="solid-action" onClick={() => setScreen("pid")}>Use my PID or employee ID <Arrow /></button>
            <button className="outline-action" onClick={() => setScreen("new-here")}>I’m new here</button>
            <button className="quiet-action" onClick={() => setScreen("home")}>Try the card again</button>
          </div>
          </div>
        )}

        {screen === "waiver-required" && (
          <div className="status-content screen-content">
            <p className="eyebrow warning">WAIVER REQUIRED</p>
            <h1>One step before<br />you check in.</h1>
            <p className="lede">We found your Sandbox account, but not a current waiver. Please ask staff for help before using the space.</p>
            <div className="button-row">
              <button className="solid-action" onClick={() => setScreen("home")}>Done</button>
              <button className="outline-action" onClick={() => setScreen("pid")}>Use another ID</button>
            </div>
          </div>
        )}

        {screen === "backend-error" && (
          <div className="status-content screen-content">
            <p className="eyebrow warning">CHECK-IN NOT RECORDED</p>
            <h1>Please check in<br />with staff.</h1>
            <p className="lede">The card reader worked, but the attendance log did not. Staff can let you through while the kiosk reconnects.</p>
            <button className="solid-action" onClick={() => setScreen("home")}>Try again</button>
          </div>
        )}

        {screen === "link-card" && (
          <div className="form-content screen-content">
            <button className="back" onClick={() => setScreen("unknown-card")}><Arrow direction="left" /> Back</button>
            <p className="eyebrow">STAFF-ASSISTED CARD LINK</p>
            <h1>Confirm the<br />member’s account.</h1>
            <p className="lede compact">Staff: inspect the member’s physical ID, then enter its PID or employee ID.</p>
            <form onSubmit={startCardLink}>
              <label htmlFor="link-identifier">PID OR EMPLOYEE ID</label>
              <input
                id="link-identifier"
                value={linkIdentifier}
                onChange={(event) => setLinkIdentifier(event.target.value.toUpperCase().slice(0, 32))}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="A12345678"
              />
              <button className="solid-action" type="submit" disabled={!linkIdentifier.trim()}>Continue to staff authorization <Arrow /></button>
            </form>
            {linkError && <p className="error" role="alert">{linkError}</p>}
            <button className="quiet-action align-left" onClick={() => setScreen("pid")}>Check in without connecting the card</button>
          </div>
        )}

        {screen === "link-authorize" && (
          <div className="status-content screen-content">
            <button className="back" onClick={cancelCardLink}><Arrow direction="left" /> Cancel</button>
            <p className="eyebrow">DESIGNATED STAFF AUTHORIZATION</p>
            <h1>{staffCardDetected ? <>Checking staff<br />authorization…</> : <>Staff: tap your<br />own ID card.</>}</h1>
            <p className="lede">Connecting the waiting card to <b>{linkTargetName}</b>. Only a designated staff card can approve this change.</p>
            <p className="field-note">Do not tap the member’s card again until authorization is complete.</p>
          </div>
        )}

        {screen === "link-error" && (
          <div className="status-content screen-content">
            <p className="eyebrow warning">CARD NOT CONNECTED</p>
            <h1>Staff authorization<br />didn’t complete.</h1>
            <p className="lede">{linkError}</p>
            <div className="button-row">
              <button className="solid-action" onClick={() => { setLinkError(""); setStaffCardDetected(false); setScreen("link-authorize"); }}>Try another staff card</button>
              <button className="outline-action" onClick={cancelCardLink}>Cancel</button>
            </div>
          </div>
        )}

        {screen === "card-linked" && (
          <div className="status-content screen-content">
            <p className="eyebrow">CARD CONNECTED</p>
            <h1>{welcomeName},<br />you’re ready.</h1>
            <p className="lede">Tap the newly connected card again to check in. A waiver is still required before entry.</p>
            <button className="solid-action" onClick={reset}>Return to check-in <Arrow /></button>
          </div>
        )}

        {screen === "reader-error" && (
          <div className="status-content screen-content">
            <p className="eyebrow warning">TRY THAT AGAIN</p>
            <h1>The reader didn’t<br />catch your card.</h1>
            <p className="lede">Hold it flat against the reader for a full second.</p>
            <div className="button-row">
              <button className="solid-action" onClick={() => setScreen("home")}>Try again</button>
              <button className="outline-action" onClick={() => setScreen("pid")}>Use PID</button>
            </div>
          </div>
        )}

        {screen === "profile" && (
          <div className="form-content screen-content">
            <p className="eyebrow">YOU’RE CHECKED IN</p>
            <h1>One quick<br />question.</h1>
            <p className="lede compact">What best describes your role at UC San Diego?</p>
            <div className="choice-grid">
              {affiliations.map((item) => (
                <button
                  key={item}
                  className={affiliation === item ? "selected" : ""}
                  onClick={() => { setAffiliation(item); setScreen("profile-detail"); }}
                >
                  {item}<Arrow />
                </button>
              ))}
            </div>
            <button className="quiet-action align-left" onClick={() => setScreen("success")}>Skip for now</button>
          </div>
        )}

        {screen === "profile-detail" && (
          <div className="form-content screen-content">
            <button className="back" onClick={() => setScreen("profile")}><Arrow direction="left" /> Back</button>
            <p className="eyebrow">LAST ONE</p>
            <h1>Your program<br />or department?</h1>
            <p className="lede compact">This helps us understand who the Makerspace serves.</p>
            <form onSubmit={(event) => { event.preventDefault(); setScreen("success"); }}>
              <label htmlFor="detail">PROGRAM OR DEPARTMENT</label>
              <input
                id="detail"
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="e.g. Scripps Oceanography"
                autoFocus
              />
              <button className="solid-action" type="submit" disabled={!detail.trim()}>Save and finish <Arrow /></button>
            </form>
            <button className="quiet-action align-left" onClick={() => setScreen("success")}>Skip for now</button>
          </div>
        )}

        {screen === "new-here" && (
          <div className="onboarding-content screen-content">
            <button className="back" onClick={() => setScreen("home")}><Arrow direction="left" /> Back</button>
            <p className="eyebrow">WELCOME TO THE SANDBOX</p>
            <h1>Make something<br />unexpected.</h1>
            <div className="onboarding-grid">
              <div>
                <p className="lede">Scan with your phone to submit your Sandbox profile. After the waiver, ask staff to finish setup and connect your card.</p>
                <ol>
                  <li><b>01</b><span>Submit your profile</span></li>
                  <li><b>02</b><span>Complete the liability waiver</span></li>
                  <li><b>03</b><span>Ask staff to activate your account</span></li>
                </ol>
              </div>
              {REGISTRATION_URL && <div className="qr-code" aria-label="QR code for the Scripps Sandbox registration form">
                <QRCodeSVG value={REGISTRATION_URL} size={178} level="M" bgColor="#f2eee3" fgColor="#092235" />
                <span>SCAN TO JOIN</span>
              </div>}
            </div>
            {REGISTRATION_URL
              ? <a className="outline-action onboarding-link" href={REGISTRATION_URL} target="_blank" rel="noreferrer">Open the registration form</a>
              : <p className="lede compact">The registration link is not configured yet. Please ask Sandbox staff for help.</p>}
            <button className="outline-action" onClick={() => setScreen("pid")}>I already registered</button>
          </div>
        )}
      </section>

      {screen === "success" && (
        <section className="success-plane">
          <div className="success-mark" aria-hidden="true">✓</div>
          <p className="eyebrow">CHECK-IN COMPLETE</p>
          <h1>Welcome back,<br />{welcomeName}.</h1>
          <p className="lede">You’re checked in to the Scripps Sandbox.</p>
          {minutesUntilClose !== null && (
            <div className="success-closing-alert" role="alert">
              <span>{String(minutesUntilClose).padStart(2, "0")}</span>
              <p><b>CLOSING SOON</b>{closingLabel}. Please choose a project you can stop safely before then.</p>
            </div>
          )}
          <div className="visit-card">
            <span>TODAY</span>
            <b>{timeLabel}</b>
            <span>{visitCount === null ? "CHECKED IN" : `VISIT DAY ${visitCount}`}</span>
          </div>
          <button className="solid-action navy" onClick={reset}>Done</button>
          <p className="reset-note">Returning home in {countdown} seconds</p>
        </section>
      )}

      {demoControlsEnabled && demoOpen && (
        <aside className="demo-panel" aria-label="Prototype controls">
          <div className="demo-heading">
            <div><small>PROTOTYPE CONTROLS</small><b>Simulate an event</b></div>
            <button onClick={() => setDemoOpen(false)} aria-label="Close demo controls">×</button>
          </div>
          <div className={`reader-state ${scannerStatus}`}>
            <span aria-hidden="true" />
            <div><small>LOCAL CARD READER</small><b>{scannerStatus === "demo" ? "Demo mode" : scannerStatus}</b></div>
          </div>
          <button onClick={() => { startDemoCheckIn(); setDemoOpen(false); }}>Tap recognized ID <Arrow /></button>
          <button onClick={() => { setScreen("profile"); setDemoOpen(false); }}>Tap ID · missing info <Arrow /></button>
          <button onClick={() => { setScreen("unknown-card"); setDemoOpen(false); }}>Tap unknown ID <Arrow /></button>
          <button onClick={() => { setScreen("reader-error"); setDemoOpen(false); }}>Card reader error <Arrow /></button>
          <button onClick={() => { setScreen("pid"); setDemoOpen(false); }}>Manual PID check-in <Arrow /></button>
          <button onClick={() => { setScreen("new-here"); setDemoOpen(false); }}>New user <Arrow /></button>
          <button onClick={openStaffEditor}>Staff announcement <Arrow /></button>
          <button onClick={() => { setDemoClosingMinutes(18); setScreen("home"); setDemoOpen(false); }}>Simulate closing in 18 min <Arrow /></button>
          {demoClosingMinutes !== null && <button onClick={() => setDemoClosingMinutes(null)}>End closing simulation</button>}
          <button className="reset" onClick={reset}>Reset prototype</button>
        </aside>
      )}

      {staffOpen && (
        <aside className="staff-panel" aria-label="Staff announcement editor">
          <div className="staff-poster" aria-hidden="true">
            <span>!</span>
            <b>MAKE<br />IT<br />KNOWN.</b>
          </div>
          <form onSubmit={saveAnnouncement}>
            <div className="demo-heading">
              <div><small>STAFF CONTROL</small><b>Front-screen message</b></div>
              <button type="button" onClick={() => setStaffOpen(false)} aria-label="Close staff controls">×</button>
            </div>
            <p className="staff-intro">Keep it brief. The kiosk gives the announcement the scale and urgency of a temporary poster.</p>
            <div className="preset-row" aria-label="Message presets">
              <button type="button" onClick={() => setAnnouncementDraft({ ...announcementDraft, active: true, heading: "CHECK IN WITH STAFF", body: "Please check in with me upstairs before starting work." })}>Upstairs</button>
              <button type="button" onClick={() => setAnnouncementDraft({ ...announcementDraft, active: true, heading: "CHECK IN WITH STAFF", body: "Please find me at the picnic table before starting work." })}>Picnic table</button>
              <button type="button" onClick={() => setAnnouncementDraft({ ...announcementDraft, active: true, heading: "CLOSING EARLY TODAY", body: "Please ask staff about today’s adjusted hours before starting a project." })}>Closing early</button>
            </div>
            <label htmlFor="announcement-heading">SHORT HEADING</label>
            <input id="announcement-heading" maxLength={34} value={announcementDraft.heading} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, heading: event.target.value })} />
            <label htmlFor="announcement-body">MESSAGE</label>
            <textarea id="announcement-body" maxLength={120} value={announcementDraft.body} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, body: event.target.value })} />
            <label htmlFor="closing-time">TODAY’S CLOSING TIME <span>optional</span></label>
            <input id="closing-time" type="time" value={announcementDraft.closingTime} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, closingTime: event.target.value })} />
            <p className="field-note">Within 30 minutes of this time, a closing alert appears automatically on arrival and after check-in.</p>
            <label className="message-switch">
              <input type="checkbox" checked={announcementDraft.active} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, active: event.target.checked })} />
              <span>Show the staff message now</span>
            </label>
            <div className="staff-actions">
              <button className="solid-action" type="submit">Publish to kiosk <Arrow /></button>
              {announcement.active && <button className="quiet-action" type="button" onClick={() => { clearAnnouncement(); setStaffOpen(false); }}>Remove current message</button>}
            </div>
          </form>
        </aside>
      )}

      <footer>
        <span>A SPACE FOR DISCOVERY</span>
        <img src="/assets/ucsd-scripps-wordmark.png" alt="UC San Diego Scripps Institution of Oceanography" />
      </footer>
    </main>
  );
}
