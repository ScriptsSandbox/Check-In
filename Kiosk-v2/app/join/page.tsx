"use client";

import { FormEvent, useState } from "react";

type RegistrationResult = {
  applicationId: string;
  displayName: string;
  claimCode: string;
  claimCodeExpiresAt: string;
  waiverUrl: string;
};

const roles = [
  ["student", "UC San Diego student"],
  ["staff", "UC San Diego staff"],
  ["faculty", "UC San Diego faculty"],
  ["postdoc", "Postdoctoral scholar"],
  ["visitor", "Visitor or external affiliate"],
  ["other", "Other"],
];

export default function JoinPage() {
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [identifierType, setIdentifierType] = useState("pid");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const response = await fetch("/api/registrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, consent: form.get("consent") === "on" }),
      });
      const responseText = await response.text();
      let data: (RegistrationResult & { error?: string }) | null = null;
      try {
        data = JSON.parse(responseText) as RegistrationResult & { error?: string };
      } catch {
        // Local kiosk builds cannot load the hosted Cloudflare database binding.
      }
      if (!response.ok || !data) {
        throw new Error(data?.error || "Online registration is not available on this kiosk yet. Please ask Sandbox staff for help.");
      }
      setResult(data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Registration could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCode() {
    if (!result) return;
    await navigator.clipboard.writeText(result.claimCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="join-page">
      <header className="web-header">
        <a href="/" className="web-brand">SCRIPPS SANDBOX <span>MAKERSPACE</span></a>
        <span>FIRST VISIT</span>
      </header>

      {!result ? (
        <div className="join-layout">
          <section className="join-intro">
            <p className="web-eyebrow">BEFORE YOU MAKE</p>
            <h1>Create your<br />Sandbox account.</h1>
            <p>Tell us who you are, then complete the liability waiver. When you arrive, one quick card connection is all that remains.</p>
            <ol className="join-steps">
              <li><b>01</b><span>Create your account</span></li>
              <li><b>02</b><span>Sign the liability waiver</span></li>
              <li><b>03</b><span>Connect your UC San Diego ID</span></li>
            </ol>
          </section>

          <section className="join-form-plane">
            <form onSubmit={submit} className="join-form">
              <fieldset>
                <legend>YOUR NAME</legend>
                <div className="field-grid two">
                  <label>First name<input name="firstName" autoComplete="given-name" required /></label>
                  <label>Last name<input name="lastName" autoComplete="family-name" required /></label>
                </div>
                <label>Preferred name <small>optional</small><input name="preferredName" autoComplete="nickname" /></label>
              </fieldset>

              <fieldset>
                <legend>YOUR CONNECTION TO UC SAN DIEGO</legend>
                <label>Role
                  <select name="userType" required defaultValue="">
                    <option value="" disabled>Choose one</option>
                    {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>Program, department, or organization
                  <input name="affiliation" placeholder="e.g. Scripps Oceanography" required />
                </label>
                <div className="field-grid id-grid">
                  <label>ID type
                    <select
                      name="identifierType"
                      required
                      value={identifierType}
                      onChange={(event) => setIdentifierType(event.target.value)}
                    >
                      <option value="pid">Student PID</option>
                      <option value="tsn">Triton Student Number (TSN)</option>
                      <option value="employee_id">Employee ID</option>
                      <option value="other">Other UCSD ID</option>
                    </select>
                  </label>
                  <label>ID number<input
                    name="identifierValue"
                    autoCapitalize="characters"
                    autoComplete="off"
                    inputMode={identifierType === "tsn" || identifierType === "employee_id" ? "numeric" : "text"}
                    placeholder={identifierType === "tsn" ? "200010746" : identifierType === "employee_id" ? "000023" : "A12345678"}
                    required
                  /></label>
                </div>
              </fieldset>

              <fieldset>
                <legend>CONTACT</legend>
                <label>Primary email<input name="email" type="email" autoComplete="email" required /></label>
                <label>Secondary email <small>optional</small><input name="secondaryEmail" type="email" /></label>
              </fieldset>

              <label className="consent-row">
                <input name="consent" type="checkbox" required />
                <span>I understand the Sandbox will use this information to manage makerspace access, training, safety records, and visits.</span>
              </label>

              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="web-primary" type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save account and continue"}<span>→</span>
              </button>
            </form>
          </section>
        </div>
      ) : (
        <section className="join-complete">
          <p className="web-eyebrow">ACCOUNT STARTED</p>
          <h1>One signature.<br />Then one tap.</h1>
          <p className="complete-lede">Thanks, {result.displayName}. Your account will remain pending until your waiver appears in Waiver Signatures SIO.</p>

          <div className="claim-poster">
            <span>YOUR CARD-CONNECTION CODE</span>
            <strong>{result.claimCode}</strong>
            <button type="button" onClick={copyCode}>{copied ? "Copied" : "Copy code"}</button>
            <p>Save this code. At the Sandbox, tap your ID and enter it to connect the card. Staff can also connect or replace a card after checking your physical ID.</p>
          </div>

          <div className="waiver-action">
            <div><b>NEXT</b><span>Complete the Scripps Sandbox liability waiver using the same name, email, and ID number.</span></div>
            <a className="web-primary" href={result.waiverUrl} rel="noreferrer">Open liability waiver <span>↗</span></a>
          </div>

          <p className="privacy-note">Do not enter your card number online. Card identifiers are connected only while the physical card is present at the makerspace.</p>
        </section>
      )}
    </main>
  );
}
