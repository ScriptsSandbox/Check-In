"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  PROFILE_ROLES,
  affiliationOptions,
  emptyProfile,
  nextProfileQuestion,
  normalizedProfileAnswer,
  profileQuestionForField,
  type ProfileField,
  type ProfileSnapshot,
} from "@/lib/profile-enrichment";
import { KIOSK_RELEASE } from "@/lib/kiosk-release";

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
  | "group-link"
  | "group-link-error"
  | "reader-error"
  | "profile"
  | "profile-detail"
  | "new-here";

type Announcement = {
  active: boolean;
  heading: string;
  body: string;
  closingTime: string;
  closingDate: string;
};

const REGISTRATION_URL = process.env.NEXT_PUBLIC_REGISTRATION_URL?.trim() || "";
const WAIVER_URL = process.env.NEXT_PUBLIC_WAIVER_URL?.trim() || "";

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
  | "card_link_error"
  | "group_card_linked"
  | "group_link_error";

type GroupLinkRequest = {
  request_id: string;
  display_name: string;
  expires_at: string;
};

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
  person_id?: string | null;
  profile?: Partial<ProfileSnapshot>;
};

type ScannerEvent = ScannerDetectedEvent | ScannerResultEvent;

const emptyAnnouncement: Announcement = {
  active: false,
  heading: "CHECK IN WITH STAFF",
  body: "Please check in with me upstairs before starting work.",
  closingTime: "",
  closingDate: "",
};

const INACTIVITY_SECONDS = 45;
const INACTIVITY_NOTICE_SECONDS = 15;

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Arrow({ direction = "right" }: { direction?: "right" | "left" }) {
  return <span aria-hidden="true">{direction === "right" ? "→" : "←"}</span>;
}

function ordinal(value: number) {
  const modulo100 = value % 100;
  const suffix = modulo100 >= 11 && modulo100 <= 13
    ? "th"
    : value % 10 === 1
      ? "st"
      : value % 10 === 2
        ? "nd"
        : value % 10 === 3
          ? "rd"
          : "th";
  return String(value) + suffix;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [demoOpen, setDemoOpen] = useState(false);
  const [pid, setPid] = useState("");
  const [checkInMethod, setCheckInMethod] = useState<"card" | "identifier">("card");
  const [profile, setProfile] = useState<ProfileSnapshot>(emptyProfile);
  const [profileSessionAvailable, setProfileSessionAvailable] = useState(false);
  const [profileAnswer, setProfileAnswer] = useState("");
  const [profileOther, setProfileOther] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileEditingField, setProfileEditingField] = useState<ProfileField | null>(null);
  const [linkIdentifier, setLinkIdentifier] = useState("");
  const [linkTargetName, setLinkTargetName] = useState("Sandbox member");
  const [linkError, setLinkError] = useState("");
  const [staffCardDetected, setStaffCardDetected] = useState(false);
  const [countdown, setCountdown] = useState(8);
  const [idleCountdown, setIdleCountdown] = useState(INACTIVITY_SECONDS);
  const [now, setNow] = useState<Date | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement>(emptyAnnouncement);
  const [announcementDraft, setAnnouncementDraft] = useState<Announcement>(emptyAnnouncement);
  const [staffOpen, setStaffOpen] = useState(false);
  const [demoClosingMinutes, setDemoClosingMinutes] = useState<number | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>("demo");
  const [scannerResult, setScannerResult] = useState<ScannerResultEvent | null>(null);
  const [welcomeName, setWelcomeName] = useState("Sandbox member");
  const [visitCount, setVisitCount] = useState<number | null>(null);
  const [groupLinkRequest, setGroupLinkRequest] = useState<GroupLinkRequest | null>(null);
  const [groupJustLinked, setGroupJustLinked] = useState(false);
  const demoControlsEnabled = process.env.NEXT_PUBLIC_KIOSK_DEMO === "true";
  const screenRef = useRef<Screen>("home");
  const cardDetectedAtRef = useRef<number | null>(null);
  const idleDeadlineRef = useRef<number | null>(null);
  const groupLinkRequestRef = useRef<GroupLinkRequest | null>(null);
  const profileQuestion = useMemo(
    () => profileSessionAvailable
      ? profileEditingField
        ? profileQuestionForField(profileEditingField, profile.role)
        : nextProfileQuestion(profile)
      : null,
    [profile, profileEditingField, profileSessionAvailable],
  );

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    groupLinkRequestRef.current = groupLinkRequest;
  }, [groupLinkRequest]);

  useEffect(() => {
    setNow(new Date());
    const saved = window.localStorage.getItem("sandbox-kiosk-announcement");
    if (saved) {
      try {
        const parsed = { ...emptyAnnouncement, ...JSON.parse(saved) };
        if (parsed.closingTime && parsed.closingDate !== localDateKey(new Date())) {
          parsed.closingTime = "";
          parsed.closingDate = "";
          window.localStorage.setItem("sandbox-kiosk-announcement", JSON.stringify(parsed));
        }
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
          if (event.type === "card_detected" && (screenRef.current === "home" || screenRef.current === "group-link")) {
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
    const isLocalKiosk = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!isLocalKiosk || scannerStatus !== "connected") return;
    let stopped = false;
    async function pollGroupLink() {
      try {
        const response = await fetch("http://127.0.0.1:8765/group-link/status", { cache: "no-store" });
        if (!response.ok || stopped) return;
        const result = await response.json() as { active?: boolean; request_id?: string; display_name?: string; expires_at?: string };
        if (result.active && result.request_id) {
          const request = { request_id: result.request_id, display_name: result.display_name || "Sandbox member", expires_at: result.expires_at || "" };
          setGroupLinkRequest(request);
          if (screenRef.current === "home") setScreen("group-link");
        } else {
          setGroupLinkRequest(null);
          if (screenRef.current === "group-link") setScreen("home");
        }
      } catch {
        // Normal check-in remains available if the optional staff queue cannot be reached.
      }
    }
    pollGroupLink();
    const interval = window.setInterval(pollGroupLink, 2500);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [scannerStatus]);

  useEffect(() => {
    if (screen !== "reading" || !scannerResult) return;
    const detectedAt = cardDetectedAtRef.current ?? performance.now();
    const minimumFeedbackMs = 500;
    const delay = Math.max(0, minimumFeedbackMs - (performance.now() - detectedAt));
    const timer = window.setTimeout(() => {
      if (scannerResult.outcome === "demo") {
        setCountdown(8);
        setScreen("success");
        return;
      }
      if (scannerResult.outcome === "success") {
        const incomingProfile = { ...emptyProfile(), ...(scannerResult.profile || {}) };
        const hasQuestion = Boolean(scannerResult.person_id && nextProfileQuestion(incomingProfile));
        setWelcomeName(scannerResult.display_name || "Sandbox member");
        setVisitCount(scannerResult.visit_count);
        setProfile(incomingProfile);
        setProfileSessionAvailable(Boolean(scannerResult.person_id));
        setCountdown(8);
        setScreen(hasQuestion ? "profile" : "success");
      } else if (scannerResult.outcome === "group_card_linked") {
        setWelcomeName(scannerResult.display_name || "Sandbox member");
        setVisitCount(scannerResult.visit_count);
        setGroupLinkRequest(null);
        setGroupJustLinked(true);
        setCountdown(8);
        setScreen("success");
      } else if (scannerResult.outcome === "group_link_error") {
        setLinkError(scannerResult.message || "The card could not be connected. Ask staff to try again.");
        setScreen("group-link-error");
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

  const closingStatus = useMemo(() => {
    if (demoClosingMinutes !== null) {
      return {
        mode: demoClosingMinutes <= 0 ? "closed" as const : "closing-soon" as const,
        minutes: Math.max(0, demoClosingMinutes),
      };
    }
    if (!now || !announcement.closingTime || announcement.closingDate !== localDateKey(now)) {
      return { mode: "open" as const, minutes: null };
    }
    const [hours, minutes] = announcement.closingTime.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return { mode: "open" as const, minutes: null };
    const closes = new Date(now);
    closes.setHours(hours, minutes, 0, 0);
    const difference = Math.ceil((closes.getTime() - now.getTime()) / 60_000);
    if (difference <= 0) return { mode: "closed" as const, minutes: 0 };
    if (difference <= 30) return { mode: "closing-soon" as const, minutes: difference };
    return { mode: "open" as const, minutes: null };
  }, [announcement.closingDate, announcement.closingTime, demoClosingMinutes, now]);

  const minutesUntilClose = closingStatus.minutes;

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
      closingDate: announcementDraft.closingTime ? localDateKey(new Date()) : "",
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

  const reset = useCallback(() => {
    const previousScreen = screenRef.current;
    const pendingGroupLink = groupLinkRequestRef.current;
    if ((previousScreen === "group-link" || previousScreen === "group-link-error") && pendingGroupLink) {
      fetch("http://127.0.0.1:8765/group-link/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: pendingGroupLink.request_id }),
      }).catch(() => undefined);
    }
    if (!["home", "reading", "success"].includes(previousScreen)) {
      fetch("http://127.0.0.1:8765/scanner/allow-repeat", { method: "POST" }).catch(() => undefined);
    }
    cardDetectedAtRef.current = null;
    setScannerResult(null);
    setWelcomeName("Sandbox member");
    setVisitCount(null);
    setScreen("home");
    setCheckInMethod("card");
    setPid("");
    setProfile(emptyProfile());
    setProfileSessionAvailable(false);
    setProfileAnswer("");
    setProfileOther("");
    setProfileSaving(false);
    setProfileError("");
    setProfileEditingField(null);
    setLinkIdentifier("");
    setLinkTargetName("Sandbox member");
    setLinkError("");
    setStaffCardDetected(false);
    setGroupLinkRequest(null);
    setGroupJustLinked(false);
    setDemoOpen(false);
  }, []);

  useEffect(() => {
    const returnHome = (event: KeyboardEvent) => {
      if (event.key === "Escape") reset();
    };
    window.addEventListener("keydown", returnHome);
    return () => window.removeEventListener("keydown", returnHome);
  }, [reset]);

  const idleTimerActive = screen !== "home" && screen !== "reading" && screen !== "success" && !staffOpen;

  const extendIdleTimer = useCallback(() => {
    idleDeadlineRef.current = Date.now() + INACTIVITY_SECONDS * 1000;
    setIdleCountdown(INACTIVITY_SECONDS);
  }, []);

  useEffect(() => {
    idleDeadlineRef.current = null;
    setIdleCountdown(INACTIVITY_SECONDS);
    if (!idleTimerActive) return;

    idleDeadlineRef.current = Date.now() + INACTIVITY_SECONDS * 1000;
    let expired = false;
    const tick = () => {
      const deadline = idleDeadlineRef.current;
      if (deadline === null || expired) return;
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setIdleCountdown(remaining);
      if (remaining === 0) {
        expired = true;
        window.clearInterval(interval);
        if (screen === "link-authorize" || screen === "link-error") {
          fetch("http://127.0.0.1:8765/card-link/cancel", { method: "POST" }).catch(() => undefined);
        }
        reset();
      }
    };
    const interval = window.setInterval(tick, 250);
    return () => {
      expired = true;
      window.clearInterval(interval);
    };
  }, [idleTimerActive, reset, screen]);

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

  async function saveProfileAnswer(field: ProfileField, rawValue: string) {
    const value = normalizedProfileAnswer(field, rawValue);
    if (!value || profileSaving) return;
    setProfileSaving(true);
    setProfileError("");
    try {
      let updatedProfile: ProfileSnapshot;
      if (demoControlsEnabled && !profileSessionAvailable) {
        updatedProfile = { ...profile, [field]: value };
        if (field === "role" && profile.role && profile.role !== value) {
          updatedProfile.affiliation = "";
          updatedProfile.anticipatedGraduation = "";
        }
      } else {
        const response = await fetch("http://127.0.0.1:8765/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, value }),
        });
        const result = await response.json() as {
          ok?: boolean;
          profile?: Partial<ProfileSnapshot>;
          detail?: string;
          message?: string;
        };
        if (!response.ok || !result.ok) {
          throw new Error(result.detail || result.message || "That answer could not be saved.");
        }
        updatedProfile = { ...profile, ...(result.profile || {}), [field]: value };
      }
      setProfile(updatedProfile);
      setProfileEditingField(null);
      setProfileAnswer("");
      setProfileOther("");
      if (!nextProfileQuestion(updatedProfile)) {
        setCountdown(8);
        setScreen("success");
      }
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "That answer could not be saved.");
    } finally {
      setProfileSaving(false);
    }
  }

  function skipProfileQuestions() {
    setCountdown(8);
    setScreen("success");
  }

  function editProfileField(field: ProfileField) {
    setProfileEditingField(field);
    setProfileError("");
    const currentValue = profile[field];
    if (field === "affiliation" && currentValue.startsWith("Other – ")) {
      setProfileAnswer("Other");
      setProfileOther(currentValue.slice("Other – ".length));
    } else {
      setProfileAnswer(field === "role" ? "" : currentValue);
      setProfileOther("");
    }
  }

  function profileBack() {
    if (profileQuestion?.field === "anticipatedGraduation") {
      editProfileField("affiliation");
    } else if (profileQuestion?.field === "affiliation") {
      editProfileField("role");
    } else {
      setProfileEditingField(null);
      setScreen("profile");
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
          <button
            className="staff-toggle"
            onClick={openStaffEditor}
            aria-label={`Open staff controls. Kiosk revision ${KIOSK_RELEASE.revision}`}
          >
            STAFF
          </button>
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
              <p className="reader-offline-notice" role="status">Card reader unavailable. Use your PID, TSN, or employee ID below.</p>
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
                  <article className={`arrival-alert closing-alert ${closingStatus.mode === "closed" ? "closed-alert" : ""}`}>
                    <span className="alert-index" aria-hidden="true">{closingStatus.mode === "closed" ? "×" : String(minutesUntilClose).padStart(2, "0")}</span>
                    <div>
                      <p>{closingStatus.mode === "closed" ? "MAKERSPACE CLOSED" : "CLOSING SOON"}</p>
                      <strong>{closingStatus.mode === "closed" ? "Please see staff before beginning or continuing work." : `${closingLabel}. Please plan your work accordingly.`}</strong>
                    </div>
                  </article>
                )}
              </div>
            )}
            <div className="primary-actions">
              <button className="text-action" onClick={() => setScreen("pid")}>
                <span><small>NO CARD?</small>Check in with UCSD ID or employee ID</span>
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

        {screen === "group-link" && groupLinkRequest && (
          <div className="status-content screen-content group-link-content">
            <p className="eyebrow">STAFF DESK READY</p>
            <h1>{groupLinkRequest.display_name.split(/\s+/)[0]}, tap your<br />ID card now.</h1>
            <p className="lede">Hold your card near the blue hand below. This will connect your card and check you in.</p>
            <div className="group-link-callout"><b>CHECK THE NAME ABOVE</b><span>If this is not you, choose Cancel and ask staff for help.</span></div>
            <button className="outline-action" onClick={reset}>Not {groupLinkRequest.display_name.split(/\s+/)[0]}? Cancel</button>
          </div>
        )}

        {screen === "group-link-error" && (
          <div className="status-content screen-content">
            <p className="eyebrow warning">CARD NOT CONNECTED</p>
            <h1>Please ask staff<br />to try again.</h1>
            <p className="lede">{linkError}</p>
            <button className="solid-action" onClick={reset}>Return to start</button>
          </div>
        )}

        {screen === "pid" && (
          <div className="form-content screen-content">
            <button className="back" onClick={reset}><Arrow direction="left" /> Back</button>
            <p className="eyebrow">CHECK IN WITHOUT A CARD</p>
            <h1>Enter your ID.</h1>
            <p className="lede compact">Use your student PID, nine-digit TSN, or UC San Diego employee ID.</p>
            <form onSubmit={submitPid}>
              <label htmlFor="pid">PID, TSN, OR EMPLOYEE ID</label>
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
            <button className="solid-action" onClick={() => setScreen("pid")}>Use my UCSD ID or employee ID <Arrow /></button>
            <button className="outline-action" onClick={() => setScreen("new-here")}>I’m new here</button>
            <button className="quiet-action" onClick={reset}>Try the card again</button>
          </div>
          </div>
        )}

        {screen === "waiver-required" && (
        <div className="status-content screen-content waiver-required-content">
          <div className="waiver-copy">
            <p className="eyebrow warning">WAIVER REQUIRED</p>
            <h1>Sign the waiver<br />on your phone.</h1>
            <p className="lede">We found your Sandbox account, but no signed waiver is on file. Scan the code and complete the DocuSign waiver.</p>
            <div className="waiver-delay-note" role="note">
              <b>ALLOW UP TO 15 MINUTES</b>
              <span>Your signed waiver may take a little while to appear here. You do not need to tap repeatedly—return later and tap once.</span>
            </div>
            <div className="button-row">
              <button className="solid-action" onClick={reset}>Done — return to check-in</button>
            </div>
          </div>
          {WAIVER_URL && (
            <div className="qr-code qr-code-large waiver-qr" aria-label="QR code for the Scripps Sandbox DocuSign waiver">
              <QRCodeSVG value={WAIVER_URL} size={286} level="M" bgColor="#f2eee3" fgColor="#092235" />
              <span>SCAN TO SIGN THE WAIVER</span>
            </div>
          )}
        </div>
      )}

      {screen === "backend-error" && (
          <div className="status-content screen-content">
            <p className="eyebrow warning">CHECK-IN NOT RECORDED</p>
            <h1>Please check in<br />with staff.</h1>
            <p className="lede">The card reader worked, but the attendance log did not. Staff can let you through while the kiosk reconnects.</p>
            <button className="solid-action" onClick={reset}>Try again</button>
          </div>
        )}

        {screen === "link-card" && (
          <div className="form-content screen-content">
            <button className="back" onClick={() => setScreen("unknown-card")}><Arrow direction="left" /> Back</button>
            <p className="eyebrow">STAFF-ASSISTED CARD LINK</p>
            <h1>Confirm the<br />member’s account.</h1>
            <p className="lede compact">Staff: inspect the member’s physical ID, then enter their PID, TSN, or employee ID. Their new card will replace any card currently connected to the account.</p>
            <form onSubmit={startCardLink}>
              <label htmlFor="link-identifier">PID, TSN, OR EMPLOYEE ID</label>
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
            <p className="lede">Replacing the card for <b>{linkTargetName}</b>. Only a designated staff card can approve this change.</p>
            <p className="field-note">Approval disables the account’s previous card. Do not tap the member’s new card again until authorization is complete.</p>
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
            <p className="lede">The previous card is disabled. Tap the new card again to check in. A waiver is still required before entry.</p>
            <button className="solid-action" onClick={reset}>Return to check-in <Arrow /></button>
          </div>
        )}

        {screen === "reader-error" && (
          <div className="status-content screen-content">
            <p className="eyebrow warning">TRY THAT AGAIN</p>
            <h1>The reader didn’t<br />catch your card.</h1>
            <p className="lede">Hold it flat against the reader for a full second.</p>
            <div className="button-row">
              <button className="solid-action" onClick={reset}>Try again</button>
              <button className="outline-action" onClick={() => setScreen("pid")}>Use another ID</button>
            </div>
          </div>
        )}

        {screen === "profile" && (
          <div className="profile-shell screen-content">
            <div className="profile-card profile-intro-card">
              <span className="profile-card-tab" aria-hidden="true">PROFILE UPDATE</span>
              <div className="profile-pulse" aria-hidden="true"><i /><i /><i /></div>
              <p className="eyebrow">ONE QUICK UPDATE</p>
              <h1>Your account is missing<br />a few details.</h1>
              <p className="lede compact">Before the confirmation screen, please answer a few short questions. We’ll only ask for information that’s missing.</p>
              <button className="solid-action" onClick={() => setScreen("profile-detail")}>Answer the first question <Arrow /></button>
              <button className="quiet-action align-left" onClick={skipProfileQuestions}>Skip for now</button>
              <button className="quiet-action align-left" onClick={reset}>Start over and tap your ID again</button>
            </div>
          </div>
        )}

        {screen === "profile-detail" && (
          <div className="profile-shell screen-content">
            <div className="profile-card profile-question-card">
              <span className="profile-card-tab" aria-hidden="true">ADDING TO YOUR PROFILE</span>
              <button className="back" onClick={profileBack}><Arrow direction="left" /> Back</button>
              {profileQuestion ? <>
                <p className="eyebrow">{profileQuestion.eyebrow}</p>
                <h1>{profileQuestion.heading}</h1>
                <p className="lede compact">{profileQuestion.prompt}</p>
                {profileQuestion.field === "role" ? (
                  <div className="choice-grid profile-role-grid">
                    {PROFILE_ROLES.map((item) => (
                      <button className={profile.role === item ? "selected" : ""} key={item} disabled={profileSaving} onClick={() => saveProfileAnswer("role", item)}>
                        {item}<Arrow />
                      </button>
                    ))}
                    {profileError && <p className="reader-offline-notice" role="alert">{profileError}</p>}
                  </div>
                ) : (
                  <form className="profile-form" onSubmit={(event) => {
                    event.preventDefault();
                    const value = profileAnswer === "Other" ? `Other – ${profileOther}` : profileAnswer;
                    saveProfileAnswer(profileQuestion.field, value);
                  }}>
                    <div className="profile-fields">
                      {profileQuestion.field === "anticipatedGraduation" ? (
                        <>
                          <label htmlFor="profile-answer">ANTICIPATED GRADUATION</label>
                          <input id="profile-answer" type="month" value={profileAnswer} onChange={(event) => setProfileAnswer(event.target.value)} />
                        </>
                      ) : (
                        <>
                          <label htmlFor="profile-answer">PROGRAM, DEPARTMENT, MAJOR, OR ORGANIZATION</label>
                          <select id="profile-answer" value={profileAnswer} onChange={(event) => setProfileAnswer(event.target.value)}>
                            <option value="">Choose one</option>
                            {affiliationOptions(profile.role).map((item) => <option key={item}>{item}</option>)}
                          </select>
                          {profileAnswer === "Other" && (
                            <input value={profileOther} onChange={(event) => setProfileOther(event.target.value)} placeholder="Type your answer" />
                          )}
                        </>
                      )}
                    </div>
                    {profileError && <p className="reader-offline-notice" role="alert">{profileError}</p>}
                    <button className="solid-action" type="submit" disabled={profileSaving || !profileAnswer || (profileAnswer === "Other" && !profileOther.trim())}>
                      {profileSaving ? "Saving…" : "Save and continue"} <Arrow />
                    </button>
                  </form>
                )}
              </> : null}
              <button className="quiet-action align-left" onClick={skipProfileQuestions}>Skip for now</button>
              <button className="quiet-action align-left" onClick={reset}>Start over and tap your ID again</button>
            </div>
          </div>
        )}

        {screen === "new-here" && (
        <div className="onboarding-content screen-content">
          <button className="back" onClick={reset}><Arrow direction="left" /> Back</button>
          <p className="eyebrow">WELCOME TO THE SANDBOX</p>
          <h1>Start on<br />your phone.</h1>
          {REGISTRATION_URL ? (
            <div className="onboarding-primary">
              <div className="qr-code qr-code-large" aria-label="QR code for the Scripps Sandbox registration form">
                <QRCodeSVG value={REGISTRATION_URL + "?v=5"} size={286} level="M" bgColor="#f2eee3" fgColor="#092235" />
                <span>SCAN TO CREATE YOUR ACCOUNT</span>
              </div>
              <div>
                <p className="lede">Use your phone to create your account and complete the liability waiver. It takes about three minutes.</p>
                <ol>
                  <li><b>01</b><span>Create your Sandbox profile</span></li>
                  <li><b>02</b><span>Complete the waiver on your phone</span></li>
                  <li><b>03</b><span>Return here and tap your card</span></li>
                </ol>
              </div>
            </div>
          ) : (
            <p className="lede compact">Phone registration is not configured yet. Please ask Sandbox staff for help.</p>
          )}
          <div className="onboarding-fallback">
            <p><b>No phone nearby?</b> You can create the account on this kiosk. The waiver must still be completed from a phone or another device.</p>
            {REGISTRATION_URL && <a className="outline-action" href={REGISTRATION_URL + "?mode=kiosk&v=5"}>Create an account on this kiosk</a>}
            <button className="quiet-action" onClick={() => setScreen("pid")}>I already registered</button>
          </div>
        </div>
      )}
    </section>

      {screen === "success" && (
        <section className={`success-plane success-${closingStatus.mode}`}>
          {closingStatus.mode === "open" ? <>
            <div className="success-mark" aria-hidden="true">✓</div>
            <p className="eyebrow">{groupJustLinked ? "CARD CONNECTED · CHECK-IN COMPLETE" : "CHECK-IN COMPLETE"}</p>
            <h1>{groupJustLinked ? <>You’re all set,<br />{welcomeName}.</> : <>Welcome back,<br />{welcomeName}.</>}</h1>
            <p className="lede">{groupJustLinked ? "Your ID card is connected and today’s visit has been recorded." : "You’re checked in to the Scripps Sandbox."}</p>
          </> : closingStatus.mode === "closing-soon" ? <>
            <div className="closing-time-badge" aria-hidden="true"><b>{String(minutesUntilClose).padStart(2, "0")}</b><span>MIN</span></div>
            <p className="eyebrow">CHECK-IN RECORDED · CLOSING SOON</p>
            <h1>We close in<br />{minutesUntilClose} minutes.</h1>
            <p className="lede">Welcome, {welcomeName}. Only begin work you can stop and clean up safely before closing.</p>
          </> : <>
            <div className="closed-stripe" aria-hidden="true">CLOSED</div>
            <p className="eyebrow">CHECK-IN RECORDED · MAKERSPACE CLOSED</p>
            <h1>Please see<br />a staff member.</h1>
            <p className="lede">The door may still be open, but do not begin or continue work without staff approval.</p>
          </>}
          {closingStatus.mode !== "open" && (
            <article className={`success-closing-alert ${closingStatus.mode === "closed" ? "closed-alert" : ""}`} role="alert">
              <span aria-hidden="true">{closingStatus.mode === "closed" ? "×" : String(minutesUntilClose).padStart(2, "0")}</span>
              <p>
                <b>{closingStatus.mode === "closed" ? "MAKERSPACE CLOSED" : "CLOSING SOON"}</b>
                {closingStatus.mode === "closed"
                  ? "Please see staff before beginning or continuing work."
                  : `${closingLabel}. Please plan your work and cleanup accordingly.`}
              </p>
            </article>
          )}
          <div className="visit-card">
            <span>TODAY</span>
            <b>{timeLabel}</b>
            <span>{visitCount === null ? "CHECKED IN" : ordinal(visitCount) + " Visit"}</span>
          </div>
          <button className="solid-action navy" onClick={reset}>Done</button>
          <p className="reset-note">Returning home in {countdown} seconds</p>
        </section>
      )}

      {idleTimerActive && idleCountdown <= INACTIVITY_NOTICE_SECONDS && (
        <aside className="idle-return" role="status" aria-live="polite">
          <div className="idle-ring" style={{ "--idle-progress": `${(idleCountdown / INACTIVITY_NOTICE_SECONDS) * 360}deg` } as React.CSSProperties}>
            <span>{idleCountdown}</span>
          </div>
          <div><small>RETURNING TO START</small><b>This page will close automatically.</b></div>
          <button type="button" onClick={extendIdleTimer}>Stay here</button>
        </aside>
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
          <button onClick={() => { setProfile(emptyProfile()); setProfileSessionAvailable(false); setScreen("profile"); setDemoOpen(false); }}>Tap ID · missing info <Arrow /></button>
          <button onClick={() => { setScreen("unknown-card"); setDemoOpen(false); }}>Tap unknown ID <Arrow /></button>
          <button onClick={() => { setScreen("waiver-required"); setDemoOpen(false); }}>Waiver required <Arrow /></button>
          <button onClick={() => { setScreen("reader-error"); setDemoOpen(false); }}>Card reader error <Arrow /></button>
          <button onClick={() => { setScreen("pid"); setDemoOpen(false); }}>Manual ID check-in <Arrow /></button>
          <button onClick={() => { setScreen("new-here"); setDemoOpen(false); }}>New user <Arrow /></button>
          <button onClick={openStaffEditor}>Staff announcement <Arrow /></button>
          <button onClick={() => { setDemoClosingMinutes(18); setScreen("home"); setDemoOpen(false); }}>Simulate closing in 18 min <Arrow /></button>
          <button onClick={() => { setDemoClosingMinutes(0); setScreen("home"); setDemoOpen(false); }}>Simulate closed <Arrow /></button>
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
            <section className="release-card" aria-label={`Current kiosk revision ${KIOSK_RELEASE.revision}`}>
              <div>
                <small>CURRENT KIOSK REV</small>
                <strong>{KIOSK_RELEASE.revision}</strong>
              </div>
              <time dateTime="2026-08-14">{KIOSK_RELEASE.date}</time>
              <p>{KIOSK_RELEASE.summary}</p>
            </section>
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
            <p className="field-note">Within 30 minutes, check-ins receive a full closing-soon screen. At closing, they are told to see staff. This setting expires at midnight.</p>
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
