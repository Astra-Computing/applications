interface Props { va: number; vb: number; }

export default function VoteBar({ va, vb }: Props) {
  const total = va + vb;
  const pct = total > 0 ? Math.round((va / total) * 100) : 50;
  return (
    <div className="vote-bar-row">
      <span className="vote-count">{va}</span>
      <div className="vote-bar-track">
        <div className="vote-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="vote-count right">{vb}</span>
    </div>
  );
}
