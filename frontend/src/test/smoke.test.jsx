import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes, wallets, invoice } from "./fixtures";

let state;
vi.mock("../context/Auth", () => ({ useApp: () => state, AppProvider: ({ children }) => children }));
vi.mock("../context/Toasts", () => ({ useToast: () => ({ push: vi.fn(), update: vi.fn(), dismiss: vi.fn() }), ToastProvider: ({ children }) => children }));

import App from "../App";
import Landing from "../pages/Landing";
import Login from "../pages/Login";
import Register from "../pages/Register";

const user = (role, extra = {}) => ({ wallet: wallets[role], role, name: "Test User", company: "Test Co", email: null, status: "active", chain_role_synced: true, ...extra });
const mkState = (role, extra = {}) => ({ phase: "ready", user: user(role, extra), wallet: wallets[role], chainId: 31337, requiredChain: 31337, wrongNetwork: false, balances: { eth: 1.2345, tusd: 10000 }, config: routes["/chain/config"], configError: null,
  runTx: vi.fn(async () => "0xabc"), connect: vi.fn(), logout: vi.fn(), refreshUser: vi.fn(), refreshBalances: vi.fn(), fixNetwork: vi.fn(), setUser: vi.fn(), reloadConfig: vi.fn() });

beforeEach(() => {
  global.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^\/api/, "").split("?")[0];
    const body = routes[path];
    if (!body) return new Response(JSON.stringify({ detail: `no fixture for ${path}` }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  localStorage.clear();
});
afterEach(cleanup);

const open = (path, role = "supplier", extra) => { state = mkState(role, extra); return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); };

describe("public pages", () => {
  it("landing renders hero and safeguards", () => {
    state = { phase: "idle" };
    render(<MemoryRouter><Landing /></MemoryRouter>);
    expect(screen.getByText(/Get paid today/i)).toBeTruthy();
    expect(screen.getByText(/AI advises, it never approves/i)).toBeTruthy();
  });
  it("login shows connect button", () => {
    state = { ...mkState("supplier"), phase: "idle", user: null };
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByText(/Your wallet is your login/i)).toBeTruthy();
  });
  it("register shows the three roles", () => {
    state = { ...mkState("supplier"), phase: "needs-role", user: null };
    render(<MemoryRouter><Register /></MemoryRouter>);
    for (const r of ["Supplier", "Buyer", "Financier"]) expect(screen.getAllByText(r).length).toBeGreaterThan(0);
  });
});

const PAGES = {
  supplier: [["/app", /Your invoices at a glance/], ["/app/upload", /Upload an invoice/], ["/app/invoices", /My invoices/], ["/app/invoices/inv_abc123", /INV-2026-0142/], ["/app/fraud", /AI fraud & risk insights/], ["/app/assistant", /AI assistant/], ["/app/tokens", /Invoice tokens/], ["/app/transactions", /Blockchain transactions/], ["/app/profile", /Profile & wallet/]],
  buyer: [["/app", /Invoices addressed to you/], ["/app/invoices", /Invoices to verify/], ["/app/invoices/inv_abc123", /INV-2026-0142/]],
  financier: [["/app", /funding overview/], ["/app/marketplace", /Financing marketplace/], ["/app/portfolio", /My portfolio/], ["/app/tokens", /Invoice tokens/]],
  admin: [["/app/admin", /Administration/], ["/app/invoices", /All invoices/], ["/app/transactions", /Blockchain transactions/], ["/app/fraud", /AI fraud/]],
};

describe.each(Object.entries(PAGES))("%s pages render with real-shaped data", (role, list) => {
  it.each(list)("%s", async (path, heading) => {
    open(path, role);
    await waitFor(() => expect(screen.getAllByText(heading).length).toBeGreaterThan(0), { timeout: 4000 });
  });
});

describe("behaviour", () => {
  it("buyer sees verify/reject on a pending invoice", async () => {
    routes["/invoices/inv_abc123"] = { invoice: invoice({ status: "PENDING_VERIFICATION" }) };
    open("/app/invoices/inv_abc123", "buyer");
    await waitFor(() => expect(screen.getByText("Verify this invoice")).toBeTruthy());
    expect(screen.getByText("Reject")).toBeTruthy();
    routes["/invoices/inv_abc123"] = { invoice: invoice() };
  });
  it("supplier cannot request financing for a medium-risk invoice until extra verification", async () => {
    open("/app/invoices/inv_abc123", "supplier");
    await waitFor(() => expect(screen.getByText("Request financing")).toBeTruthy());
    expect(screen.getByText("Request financing").closest("button").disabled).toBe(true);
    expect(screen.getByText(/Additional verification needed/)).toBeTruthy();
  });
  it("financier sees a fund button on the marketplace and clicking it calls runTx", async () => {
    open("/app/marketplace", "financier");
    const btn = await screen.findByText("Fund");
    fireEvent.click(btn.closest("button"));
    await waitFor(() => expect(state.runTx).toHaveBeenCalled());
  });
  it("buyers are redirected away from supplier-only upload page", async () => {
    open("/app/upload", "buyer");
    await waitFor(() => expect(screen.getAllByText(/Invoices addressed to you/).length).toBeGreaterThan(0));
  });
  it("admin sees the review queue and user approvals", async () => {
    open("/app/admin", "admin");
    await waitFor(() => expect(screen.getByText("Review queue")).toBeTruthy());
    expect(screen.getByText("Approvals")).toBeTruthy();
  });
  it("assistant answers from the API", async () => {
    open("/app/assistant", "supplier");
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "status of INV-2026-0142" } });
    fireEvent.submit(screen.getByLabelText("Message").closest("form"));
    await waitFor(() => expect(screen.getByText(/is VERIFIED/)).toBeTruthy());
    expect(screen.getByText("get_invoice")).toBeTruthy();
  });
});
