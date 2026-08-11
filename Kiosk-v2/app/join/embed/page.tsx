import Image from "next/image";

export default function JoinEmbedPage() {
  return (
    <main className="join-embed-page">
      <div className="join-embed-signal" aria-hidden="true">
        <Image src="/assets/scripps-sandbox-mark.png" alt="" width={512} height={512} priority />
      </div>

      <section className="join-embed-copy">
        <p className="join-embed-eyebrow">FIRST VISIT?</p>
        <h1>Make before<br />you arrive.</h1>
        <p className="join-embed-lede">
          Create your Sandbox account and sign the liability waiver. Connect your UC San Diego ID when you get here.
        </p>

        <ol className="join-embed-steps" aria-label="Three steps">
          <li><b>01</b><span>Account</span></li>
          <li><b>02</b><span>Waiver</span></li>
          <li><b>03</b><span>One tap</span></li>
        </ol>

        <a className="join-embed-action" href="/join?source=wordpress" target="_blank" rel="noreferrer">
          <span>Start your account</span><b aria-hidden="true">↗</b>
        </a>
        <small>Opens the secure form in a new tab · about 3 minutes</small>
      </section>

      <footer className="join-embed-footer">
        <span>SCRIPPS SANDBOX <b>MAKERSPACE</b></span>
        <span>UC SAN DIEGO</span>
      </footer>
    </main>
  );
}
