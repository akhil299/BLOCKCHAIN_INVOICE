const BASE = import.meta.env.VITE_API_URL || "/api";
const KEY = "invochain.token";

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

function readable(detail, status) {
  if (!detail) return `Request failed (${status}).`;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => `${(d.loc || []).filter((x) => x !== "body").join(" › ")}: ${d.msg}`.replace(/^: /, "")).join(" · ");
  }
  return JSON.stringify(detail);
}

export async function api(path, { method = "GET", body, form, signal } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload, signal });
  } catch {
    throw new ApiError("Cannot reach the InvoChain server. Is the backend running on port 8000?", 0);
  }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(readable(data?.detail, res.status), res.status);
  return data ?? res;
}

export async function fetchBlob(path) {
  const t = getToken();
  const res = await fetch(BASE + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new ApiError("Could not load the document.", res.status);
  return res.blob();
}
