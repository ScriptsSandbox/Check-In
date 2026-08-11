"use client";

import { useMemo, useState } from "react";

type Visitor = { id: string; name: string; detail: string; checkedIn: string };
type Person = { id: string; name: string; identifier: string; training: string[] };

const startingVisitors: Visitor[] = [
  { id: "v1", name: "Maya Chen", detail: "Graduate student · SIO", checkedIn: "9:12 AM" },
  { id: "v2", name: "Jordan Rivera", detail: "Staff · Marine Physical Lab", checkedIn: "9:41 AM" },
  { id: "v3", name: "Alex Kim", detail: "Undergraduate · Mechanical Engineering", checkedIn: "10:03 AM" },
];

const startingPeople: Person[] = [
  { id: "u1", name: "Maya Chen", identifier: "A•••••472", training: ["Epilog Laser Cutter", "3D Printing"] },
  { id: "u2", name: "Jordan Rivera", identifier: "E••••108", training: ["Woodshop Basics"] },
  { id: "u3", name: "Alex Kim", identifier: "A•••••851", training: [] },
];

const trainerTools = ["Epilog Laser Cutter", "3D Printing", "Woodshop Basics"];

export default function StaffPage() {
  const [visitors, setVisitors] = useState(startingVisitors);
  const [people, setPeople] = useState(startingPeople);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("u1");
  const [message, setMessage] = useState("Please check in with me upstairs before starting work.");
  const [messageLive, setMessageLive] = useState(false);
  const [notice, setNotice] = useState("");

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return people.filter((person) => !normalized || `${person.name} ${person.identifier}`.toLowerCase().includes(normalized));
  }, [people, query]);
  const selected = people.find((person) => person.id === selectedId) ?? people[0];

  function checkOut(visitor: Visitor) {
    setVisitors((current) => current.filter((item) => item.id !== visitor.id));
    setNotice(`${visitor.name} was checked out.`);
  }

  function addTraining(tool: string) {
    if (!selected || selected.training.includes(tool)) return;
    setPeople((current) => current.map((person) => person.id === selected.id
      ? { ...person, training: [...person.training, tool] }
      : person));
    setNotice(`${tool} training was added for ${selected.name}.`);
  }

  return (
    <main className="staff-app">
      <header className="staff-app-header">
        <div><span>SCRIPPS SANDBOX</span><b>STAFF</b></div>
        <nav><a href="/">Kiosk</a><a href="/join">New account form</a><button type="button">Sign in with UCSD Google</button></nav>
      </header>

      <section className="staff-stage-banner">
        <b>IMPLEMENTATION PREVIEW</b>
        <span>Synthetic people are shown here. Real records stay in the current Sheets until migration and UCSD Google authorization are complete.</span>
      </section>

      <section className="staff-hero">
        <p>MONDAY · OPEN</p>
        <h1>{visitors.length}<span> people<br />currently inside.</span></h1>
        <div className="staff-close-card"><b>CLOSE CHECK</b><span>{visitors.length ? `${visitors.length} departure${visitors.length === 1 ? "" : "s"} still to confirm` : "Everyone has left"}</span></div>
      </section>

      {notice && <button className="staff-toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

      <div className="staff-grid">
        <section className="staff-card presence-card">
          <div className="staff-card-heading"><div><small>LIVE FLOOR</small><h2>Who’s here</h2></div><span>{visitors.length}</span></div>
          <div className="visitor-list">
            {visitors.map((visitor) => (
              <article key={visitor.id}>
                <div className="avatar">{visitor.name.split(" ").map((part) => part[0]).join("")}</div>
                <div><b>{visitor.name}</b><span>{visitor.detail}</span><small>Checked in {visitor.checkedIn}</small></div>
                <button onClick={() => checkOut(visitor)}>Mark left</button>
              </article>
            ))}
            {!visitors.length && <p className="empty-state">No one is currently checked in.</p>}
          </div>
        </section>

        <section className="staff-card message-card">
          <div className="staff-card-heading"><div><small>KIOSK FRONT SCREEN</small><h2>Arrival message</h2></div><span className={messageLive ? "live-dot on" : "live-dot"} /></div>
          <label>Message<textarea value={message} maxLength={160} onChange={(event) => setMessage(event.target.value)} /></label>
          <div className="message-presets">
            <button onClick={() => setMessage("Please check in with me upstairs before starting work.")}>Upstairs</button>
            <button onClick={() => setMessage("Please find me at the picnic table before starting work.")}>Picnic table</button>
            <button onClick={() => setMessage("We are closing early today. Ask staff before starting a project.")}>Closing early</button>
          </div>
          <button className="staff-primary" onClick={() => { setMessageLive(true); setNotice("The arrival message is now live on the kiosk."); }}>Publish to kiosk <span>→</span></button>
          {messageLive && <button className="staff-text-button" onClick={() => { setMessageLive(false); setNotice("The arrival message was removed."); }}>Remove current message</button>}
        </section>

        <section className="staff-card training-card">
          <div className="staff-card-heading"><div><small>TRAINING</small><h2>Certify a user</h2></div><span>+</span></div>
          <label className="staff-search">Search by name or ID<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing…" /></label>
          <div className="staff-people">
            {matches.map((person) => (
              <button key={person.id} className={person.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(person.id)}>
                <b>{person.name}</b><span>{person.identifier}</span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="training-detail">
              <h3>{selected.name}</h3>
              <p>Only tools this signed-in staff member is authorized to teach appear below.</p>
              {trainerTools.map((tool) => {
                const approved = selected.training.includes(tool);
                return <button key={tool} disabled={approved} onClick={() => addTraining(tool)}><span>{tool}</span><b>{approved ? "Certified" : "+ Add training"}</b></button>;
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
