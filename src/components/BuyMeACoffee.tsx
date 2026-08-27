export default function BuyMeACoffee() {
  return (
    <div className="card bmc-card">
      <div className="bmc-top">
        <svg width="37" height="35" viewBox="0 0 56 52" fill="none" aria-hidden="true">
          <path d="M14 14 Q12 10 14 6" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M23 14 Q21 10 23 6" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M32 14 Q30 10 32 6" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round"/>
          <rect x="4" y="15" width="38" height="5" rx="2.5" stroke="var(--accent)" strokeWidth="1.8" fill="rgba(79,142,247,0.12)"/>
          <path d="M6 20 L9 46 H37 L40 20 Z" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(79,142,247,0.08)"/>
          <path d="M40 26 Q52 26 52 33 Q52 40 40 40" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
        </svg>
        <p className="bmc-title">Buy me a coffee</p>
      </div>
      <p className="text-sm text-muted" style={{ textAlign: 'center' }}>
        Support this game with a small donation, and keep [UN]Quotable free to play.
      </p>
      <a
        href="https://www.buymeacoffee.com/jonbehrens"
        target="_blank"
        rel="noopener noreferrer"
        className="btn bmc-btn btn-full mt-2"
      >
        Buy me a coffee
      </a>
    </div>
  );
}
