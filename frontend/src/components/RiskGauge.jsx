import { useEffect, useState } from "react";
import { TIER } from "../lib/constants";

/** Semicircle gauge. The arc has three zones (low / medium / high) and the filled part animates to the score. */
export default function RiskGauge({ score = 0, tier, size = 220 }) {
  const [v, setV] = useState(0);
  useEffect(() => { const t = setTimeout(() => setV(score), 60); return () => clearTimeout(t); }, [score]);
  const r = 80, cx = 100, cy = 100, C = Math.PI * r;
  const color = TIER[tier]?.color || "#0A1B3D";
  const pt = (pct) => { const a = Math.PI * (1 - pct / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arc = (from, to) => { const [x1, y1] = pt(from), [x2, y2] = pt(to); return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`; };
  const [nx, ny] = pt(v);
  return (
    <figure className="inline-block text-center" style={{ width: size }} aria-label={`Risk score ${score} out of 100, ${tier ? TIER[tier].label : "not assessed"}`}>
      <svg viewBox="0 0 200 122" className="w-full">
        <path d={arc(0, 34.5)} stroke="#12A15033" strokeWidth="14" fill="none" strokeLinecap="butt" />
        <path d={arc(35.5, 69.5)} stroke="#D98E0433" strokeWidth="14" fill="none" />
        <path d={arc(70.5, 100)} stroke="#D6455D33" strokeWidth="14" fill="none" />
        <path d={arc(0, 100)} stroke={color} strokeWidth="14" fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} className="gauge-arc" />
        <circle cx={nx} cy={ny} r="7" fill="#fff" stroke={color} strokeWidth="3" />
        <text x="100" y="92" textAnchor="middle" className="fill-ink" style={{ fontSize: 38, fontWeight: 800 }}>{score}</text>
        <text x="100" y="112" textAnchor="middle" className="fill-ink-500" style={{ fontSize: 11, fontWeight: 600 }}>out of 100</text>
      </svg>
      {tier && <figcaption className="-mt-1 text-sm font-bold" style={{ color }}>{TIER[tier].label}</figcaption>}
    </figure>
  );
}
