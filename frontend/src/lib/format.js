export const money = (n, d = 2) =>
  n == null || Number.isNaN(Number(n)) ? "–" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const tusd = (n, d = 2) => (n == null ? "–" : `${money(n, d)} tUSD`);
export const short = (s, a = 6, b = 4) => (!s ? "–" : s.length <= a + b + 2 ? s : `${s.slice(0, a)}…${s.slice(-b)}`);
export const dateOnly = (s) => (!s ? "–" : new Date(s.length <= 10 ? s + "T00:00:00" : s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
export const dateTime = (s) => (!s ? "–" : new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
export function relTime(s) {
  if (!s) return "–";
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}
export const pct = (bps) => (bps == null ? "–" : `${(bps / 100).toFixed(0)}%`);
