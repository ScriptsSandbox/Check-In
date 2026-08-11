"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Screen =
  | "home"
  | "reading"
  | "success"
  | "pid"
  | "not-found"
  | "unknown-card"
  | "link-card"
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

type ScannerStatus = "demo" | "connecting" | "connected" | "disconnected";

type ScannerEvent = {
  type: "card_read";
  read_at: string;
  sequence: number;
};

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
  const [affiliation, setAffiliation] = useState("");
  const [detail, setDetail] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [countdown, setCountdown] = useState(8);
  const [now, setNow] = useState<Date | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>(emptyAnnouncement);
  const [announcementDraft, setAnnouncementDraft] = useState<Announcement>(emptyAnnouncement);
  const [staffOpen, setStaffOpen] = useState(false);
  const [demoClosingMinutes, setDemoClosingMinutes] = useState<number | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>("demo");
  const screenRef = useRef<Screen>("home");

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
          if (event.type === "card_read" && screenRef.current === "home") {
            setScreen("reading");
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
    if (screen !== "reading") return;
    const timer = window.setTimeout(() => setScreen("success"), 950);
    return () => window.clearTimeout(timer);
  }, [screen]);

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

  function reset() {
    setScreen("home");
    setPid("");
    setAffiliation("");
    setDetail("");
    setClaimCode("");
    setDemoOpen(false);
  }

  function submitPid(event: FormEvent) {
    event.preventDefault();
    const normalized = pid.trim().toUpperCase();
    if (normalized === "A12345678" || normalized === "12345678") {
      setScreen("reading");
    } else if (normalized === "A87654321" || normalized === "87654321") {
      setScreen("profile");
    } else {
      setScreen("not-found");
    }
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
          <button
            className={`demo-toggle ${demoOpen ? "active" : ""}`}
            onClick={() => setDemoOpen((open) => !open)}
            aria-expanded={demoOpen}
          >
            DEMO
          </button>
        </div>
      </header>

      {showBrand && (
        <section className="brand-plane" aria-label="Scripps Sandbox Makerspace">
          <button
            className="logo-tap-target"
            onClick={() => setScreen("reading")}
            aria-label="Simulate tapping a recognized UC San Diego ID"
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
                <span><small>NO ID?</small>Check in with PID or employee ID</span>
                <Arrow />
              </button>
              <button className="text-action" onClick={() => setScreen("new-here")}>
                <span><small>NEW HERE?</small>Get started</span>
                <Arrow />
              </button>
            </div>
            <p className="tap-hint">For this mockup, tap the large Sandbox mark—or open <b>DEMO</b>.</p>
          </div>
        )}

        {screen === "reading" && (
          <div className="status-content screen-content">
            <div className="signal" aria-hidden="true"><i /><i /><i /></div>
            <p className="eyebrow">CARD DETECTED</p>
            <h1>Reading<br />your ID…</h1>
            <p className="lede">Keep your card near the reader.</p>
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
                autoFocus
              />
              <button className="solid-action" type="submit" disabled={!pid.trim()}>
                Check in <Arrow />
              </button>
            </form>
            <p className="demo-note">Try A12345678 for a complete profile or A87654321 for a missing-info flow.</p>
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
            <p className="lede">Already registered online? Use your card-connection code. Existing members can use their PID or employee ID.</p>
            <div className="stacked-actions">
              <button className="solid-action" onClick={() => setScreen("link-card")}>Enter connection code <Arrow /></button>
              <button className="outline-action" onClick={() => setScreen("pid")}>Use my PID or employee ID</button>
              <button className="outline-action" onClick={() => setScreen("new-here")}>I’m new here</button>
              <button className="quiet-action" onClick={() => setScreen("home")}>Try the card again</button>
            </div>
          </div>
        )}

        {screen === "link-card" && (
          <div className="form-content screen-content">
            <button className="back" onClick={() => setScreen("unknown-card")}><Arrow direction="left" /> Back</button>
            <p className="eyebrow">CONNECT THIS CARD</p>
            <h1>Enter your<br />connection code.</h1>
            <p className="lede compact">It’s the eight-character code shown after you created your Sandbox account online.</p>
            <form onSubmit={(event) => { event.preventDefault(); setScreen("reading"); }}>
              <label htmlFor="claim-code">CARD-CONNECTION CODE</label>
              <input
                id="claim-code"
                value={claimCode}
                onChange={(event) => setClaimCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="7MK4Q2HP"
                autoFocus
              />
              <button className="solid-action" type="submit" disabled={claimCode.length !== 8}>Connect card and check in <Arrow /></button>
            </form>
            <button className="quiet-action align-left" onClick={() => setScreen("pid")}>I don’t have my code</button>
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
                <p className="lede">Scan to create your profile, sign the waiver, and see orientation times.</p>
                <ol>
                  <li><b>01</b><span>Create your profile</span></li>
                  <li><b>02</b><span>Complete orientation</span></li>
                  <li><b>03</b><span>Start making</span></li>
                </ol>
              </div>
              <div className="qr-placeholder" aria-label="Placeholder QR code for Sandbox registration">
                {Array.from({ length: 64 }, (_, index) => <i key={index} />)}
              </div>
            </div>
            <a className="outline-action onboarding-link" href="/join">Open the registration form on this screen</a>
            <button className="outline-action" onClick={() => setScreen("pid")}>I already registered</button>
          </div>
        )}
      </section>

      {screen === "success" && (
        <section className="success-plane">
          <div className="success-mark" aria-hidden="true">✓</div>
          <p className="eyebrow">CHECK-IN COMPLETE</p>
          <h1>Welcome back,<br />Maya.</h1>
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
            <span>VISIT 24</span>
          </div>
          <button className="solid-action navy" onClick={reset}>Done</button>
          <p className="reset-note">Returning home in {countdown} seconds</p>
        </section>
      )}

      {demoOpen && (
        <aside className="demo-panel" aria-label="Prototype controls">
          <div className="demo-heading">
            <div><small>PROTOTYPE CONTROLS</small><b>Simulate an event</b></div>
            <button onClick={() => setDemoOpen(false)} aria-label="Close demo controls">×</button>
          </div>
          <div className={`reader-state ${scannerStatus}`}>
            <span aria-hidden="true" />
            <div><small>LOCAL CARD READER</small><b>{scannerStatus === "demo" ? "Demo mode" : scannerStatus}</b></div>
          </div>
          <button onClick={() => { setScreen("reading"); setDemoOpen(false); }}>Tap recognized ID <Arrow /></button>
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
