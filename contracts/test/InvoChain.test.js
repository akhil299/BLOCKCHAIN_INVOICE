const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const Status = {
  NONE: 0, CREATED: 1, PENDING_VERIFICATION: 2, VERIFIED: 3, FINANCING_REQUESTED: 4,
  FINANCED: 5, REPAID: 6, CLOSED: 7, REJECTED: 8, FLAGGED: 9, CANCELLED: 10,
};
const Risk = { UNASSESSED: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const USD = (n) => BigInt(Math.round(n * 1e6));
const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function deployFixture() {
  const [admin, operator, supplier, buyer, financier, financier2, stranger] = await ethers.getSigners();
  const TestUSD = await ethers.getContractFactory("TestUSD");
  const usd = await TestUSD.deploy(admin.address);
  const Token = await ethers.getContractFactory("InvoiceToken");
  const token = await Token.deploy(admin.address);
  const Registry = await ethers.getContractFactory("InvoiceRegistry");
  const reg = await Registry.deploy(admin.address, await usd.getAddress(), await token.getAddress());
  await token.setRegistry(await reg.getAddress());

  await reg.grantRole(await reg.OPERATOR_ROLE(), operator.address);
  await reg.connect(operator).grantRole(await reg.SUPPLIER_ROLE(), supplier.address);
  await reg.connect(operator).grantRole(await reg.FINANCIER_ROLE(), financier.address);
  await reg.connect(operator).grantRole(await reg.FINANCIER_ROLE(), financier2.address);

  await usd.mint(financier.address, USD(1_000_000));
  await usd.mint(financier2.address, USD(1_000_000));
  await usd.mint(buyer.address, USD(1_000_000));
  await usd.mint(supplier.address, USD(1_000_000));
  return { admin, operator, supplier, buyer, financier, financier2, stranger, usd, token, reg };
}

async function nowTs() { return BigInt(await time.latest()); }

async function register(ctx, over = {}) {
  const { reg, supplier, buyer } = ctx;
  const t = await nowTs();
  const args = {
    buyer: buyer.address,
    amount: USD(10_000),
    invoiceDate: t - 86400n,
    dueDate: t + 60n * 86400n,
    docHash: h("doc-" + Math.random()),
    numberHash: h("INV-" + Math.random()),
    cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    ...over,
  };
  const tx = await reg.connect(supplier).registerInvoice(
    args.buyer, args.amount, args.invoiceDate, args.dueDate, args.docHash, args.numberHash, args.cid);
  await tx.wait();
  return { id: await reg.invoiceCount(), args };
}

async function toVerified(ctx, over = {}) {
  const r = await register(ctx, over);
  await ctx.reg.connect(ctx.operator).setRiskAssessment(r.id, Risk.LOW, h("report"));
  await ctx.reg.connect(ctx.supplier).submitForVerification(r.id);
  await ctx.reg.connect(ctx.buyer).verifyInvoice(r.id);
  return r;
}

async function toRequested(ctx, bps = 9000) {
  const r = await toVerified(ctx);
  await ctx.reg.connect(ctx.supplier).requestFinancing(r.id, bps);
  return r;
}

async function toFinanced(ctx, bps = 9000) {
  const r = await toRequested(ctx, bps);
  const advance = (r.args.amount * BigInt(bps)) / 10000n;
  await ctx.usd.connect(ctx.financier).approve(await ctx.reg.getAddress(), advance);
  await ctx.reg.connect(ctx.financier).approveFinancing(r.id);
  return { ...r, advance };
}

describe("InvoChain", () => {
  describe("deployment & roles", () => {
    it("wires contracts and roles", async () => {
      const c = await loadFixture(deployFixture);
      expect(await c.token.registry()).to.equal(await c.reg.getAddress());
      expect(await c.reg.hasRole(await c.reg.DEFAULT_ADMIN_ROLE(), c.admin.address)).to.equal(true);
      expect(await c.reg.hasRole(await c.reg.SUPPLIER_ROLE(), c.supplier.address)).to.equal(true);
    });
    it("registry cannot be rewired", async () => {
      const c = await loadFixture(deployFixture);
      await expect(c.token.setRegistry(c.stranger.address)).to.be.revertedWithCustomError(c.token, "RegistryAlreadySet");
    });
    it("strangers cannot grant roles", async () => {
      const c = await loadFixture(deployFixture);
      const role = await c.reg.FINANCIER_ROLE();
      await expect(c.reg.connect(c.stranger).grantRole(role, c.stranger.address)).to.be.reverted;
    });
    it("tUSD faucet is capped by cooldown", async () => {
      const c = await loadFixture(deployFixture);
      await c.usd.connect(c.stranger).faucet();
      expect(await c.usd.balanceOf(c.stranger.address)).to.equal(USD(10_000));
      await expect(c.usd.connect(c.stranger).faucet()).to.be.revertedWithCustomError(c.usd, "FaucetCooldown");
      await time.increase(86401);
      await c.usd.connect(c.stranger).faucet();
      expect(await c.usd.balanceOf(c.stranger.address)).to.equal(USD(20_000));
    });
  });

  describe("registration & duplicates", () => {
    it("registers an invoice in CREATED and emits an event", async () => {
      const c = await loadFixture(deployFixture);
      const { id, args } = await register(c);
      const inv = await c.reg.getInvoiceDetails(id);
      expect(inv.supplier).to.equal(c.supplier.address);
      expect(inv.buyer).to.equal(args.buyer);
      expect(inv.status).to.equal(Status.CREATED);
      expect(inv.docHash).to.equal(args.docHash);
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.CREATED);
    });
    it("only SUPPLIER_ROLE can register", async () => {
      const c = await loadFixture(deployFixture);
      const t = await nowTs();
      await expect(
        c.reg.connect(c.stranger).registerInvoice(c.buyer.address, USD(1), t - 10n, t + 1000n, h("a"), h("b"), "cid")
      ).to.be.reverted;
    });
    it("rejects duplicate document hash", async () => {
      const c = await loadFixture(deployFixture);
      const { args } = await register(c);
      const t = await nowTs();
      await expect(
        c.reg.connect(c.supplier).registerInvoice(c.buyer.address, USD(5), t - 10n, t + 1000n, args.docHash, h("other-number"), "cid")
      ).to.be.revertedWithCustomError(c.reg, "DuplicateInvoice").withArgs(1);
    });
    it("rejects same invoice number for same supplier+buyer even with a different file", async () => {
      const c = await loadFixture(deployFixture);
      const { args } = await register(c);
      const t = await nowTs();
      await expect(
        c.reg.connect(c.supplier).registerInvoice(c.buyer.address, USD(5), t - 10n, t + 1000n, h("new-file"), args.numberHash, "cid")
      ).to.be.revertedWithCustomError(c.reg, "DuplicateInvoice");
    });
    it("checkDuplicate reports existing invoices", async () => {
      const c = await loadFixture(deployFixture);
      const { id, args } = await register(c);
      const [dup, existing] = await c.reg.checkDuplicate(args.docHash, c.supplier.address, c.buyer.address, h("zzz"));
      expect(dup).to.equal(true);
      expect(existing).to.equal(id);
      const [dup2] = await c.reg.checkDuplicate(h("none"), c.supplier.address, c.buyer.address, h("none"));
      expect(dup2).to.equal(false);
    });
    it("validates inputs", async () => {
      const c = await loadFixture(deployFixture);
      const t = await nowTs();
      const call = (o) => {
        const a = { buyer: c.buyer.address, amount: USD(1), inv: t - 10n, due: t + 1000n, d: h("d" + Math.random()), n: h("n" + Math.random()), cid: "cid", ...o };
        return c.reg.connect(c.supplier).registerInvoice(a.buyer, a.amount, a.inv, a.due, a.d, a.n, a.cid);
      };
      await expect(call({ buyer: ethers.ZeroAddress })).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(call({ buyer: c.supplier.address })).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(call({ amount: 0n })).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(call({ due: t - 20n })).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(call({ due: t - 5n, inv: t - 10n })).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(call({ cid: "" })).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(call({ d: ethers.ZeroHash })).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(call({ inv: t + 10n * 86400n, due: t + 20n * 86400n })).to.be.revertedWithCustomError(c.reg, "InvalidInput");
    });
    it("reverts on unknown invoice ids", async () => {
      const c = await loadFixture(deployFixture);
      await expect(c.reg.getInvoiceStatus(99)).to.be.revertedWithCustomError(c.reg, "InvoiceNotFound");
    });
  });

  describe("buyer verification", () => {
    it("only the supplier can submit, only the named buyer can verify", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await register(c);
      await expect(c.reg.connect(c.supplier).submitForVerification(id)).to.be.revertedWithCustomError(c.reg, "NotEligible");
      await c.reg.connect(c.operator).setRiskAssessment(id, Risk.LOW, h("r"));
      await expect(c.reg.connect(c.stranger).submitForVerification(id)).to.be.revertedWithCustomError(c.reg, "NotSupplier");
      await expect(c.reg.connect(c.buyer).verifyInvoice(id)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
      await c.reg.connect(c.supplier).submitForVerification(id);
      await expect(c.reg.connect(c.stranger).verifyInvoice(id)).to.be.revertedWithCustomError(c.reg, "NotBuyer");
      await expect(c.reg.connect(c.supplier).verifyInvoice(id)).to.be.revertedWithCustomError(c.reg, "NotBuyer");
      await expect(c.reg.connect(c.buyer).verifyInvoice(id)).to.emit(c.reg, "InvoiceVerified");
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.VERIFIED);
    });
    it("mints exactly one ERC-721 to the supplier with on-chain metadata", async () => {
      const c = await loadFixture(deployFixture);
      const { id, args } = await toVerified(c);
      expect(await c.token.ownerOf(id)).to.equal(c.supplier.address);
      const uri = await c.token.tokenURI(id);
      expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
      const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
      const attr = Object.fromEntries(json.attributes.map((a) => [a.trait_type, a.value]));
      expect(attr["Invoice Hash"]).to.equal(args.docHash);
      expect(attr["Status"]).to.equal("VERIFIED");
      await expect(c.reg.connect(c.buyer).verifyInvoice(id)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
    });
    it("nobody but the registry can mint or burn tokens", async () => {
      const c = await loadFixture(deployFixture);
      await expect(c.token.connect(c.stranger).mint(c.stranger.address, 1)).to.be.revertedWithCustomError(c.token, "NotRegistry");
      await expect(c.token.connect(c.admin).burn(1)).to.be.revertedWithCustomError(c.token, "NotRegistry");
    });
    it("rejection frees the duplicate keys so a corrected invoice can be resubmitted", async () => {
      const c = await loadFixture(deployFixture);
      const { id, args } = await register(c);
      await c.reg.connect(c.operator).setRiskAssessment(id, Risk.LOW, h("r"));
      await c.reg.connect(c.supplier).submitForVerification(id);
      await expect(c.reg.connect(c.buyer).rejectInvoice(id, h("wrong amount"))).to.emit(c.reg, "InvoiceRejected");
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.REJECTED);
      await expect(c.reg.connect(c.buyer).verifyInvoice(id)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
      const t = await nowTs();
      await c.reg.connect(c.supplier).registerInvoice(c.buyer.address, USD(9_000), t - 10n, t + 1000n, args.docHash, args.numberHash, "cid2");
      expect(await c.reg.invoiceCount()).to.equal(2);
    });
    it("only the buyer can reject", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await register(c);
      await c.reg.connect(c.operator).setRiskAssessment(id, Risk.LOW, h("r"));
      await c.reg.connect(c.supplier).submitForVerification(id);
      await expect(c.reg.connect(c.stranger).rejectInvoice(id, h("x"))).to.be.revertedWithCustomError(c.reg, "NotBuyer");
    });
  });

  describe("AI risk gating (advisory input, contract-owned rules)", () => {
    it("only the operator can record risk; AI cannot verify or finance", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await register(c);
      await expect(c.reg.connect(c.stranger).setRiskAssessment(id, Risk.LOW, h("r"))).to.be.reverted;
      await expect(c.reg.connect(c.supplier).setRiskAssessment(id, Risk.LOW, h("r"))).to.be.reverted;
      await c.reg.connect(c.operator).setRiskAssessment(id, Risk.LOW, h("r"));
      expect((await c.reg.getInvoiceDetails(id)).risk).to.equal(Risk.LOW);
      await expect(c.reg.connect(c.operator).verifyInvoice(id)).to.be.revertedWithCustomError(c.reg, "NotBuyer");
      await expect(c.reg.connect(c.operator).approveFinancing(id)).to.be.reverted;
    });
    it("HIGH risk holds the invoice in FLAGGED and blocks the flow until an admin clears it", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await register(c);
      await c.reg.connect(c.operator).setRiskAssessment(id, Risk.LOW, h("first"));
      await c.reg.connect(c.supplier).submitForVerification(id);
      await expect(c.reg.connect(c.operator).setRiskAssessment(id, Risk.HIGH, h("r"))).to.emit(c.reg, "InvoiceFlagged");
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.FLAGGED);
      await expect(c.reg.connect(c.buyer).verifyInvoice(id)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
      await expect(c.reg.connect(c.operator).clearFlag(id, Risk.LOW)).to.be.reverted; // operator is not admin
      await expect(c.reg.connect(c.admin).clearFlag(id, Risk.HIGH)).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await c.reg.connect(c.admin).clearFlag(id, Risk.MEDIUM);
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.PENDING_VERIFICATION);
      await c.reg.connect(c.buyer).verifyInvoice(id);
    });
    it("MEDIUM risk needs extra verification before financing can be requested", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await register(c);
      await c.reg.connect(c.operator).setRiskAssessment(id, Risk.MEDIUM, h("r"));
      await c.reg.connect(c.supplier).submitForVerification(id);
      await c.reg.connect(c.buyer).verifyInvoice(id);
      await expect(c.reg.connect(c.supplier).requestFinancing(id, 9000)).to.be.revertedWithCustomError(c.reg, "NotEligible");
      await c.reg.connect(c.operator).confirmExtraVerification(id);
      await c.reg.connect(c.supplier).requestFinancing(id, 9000);
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.FINANCING_REQUESTED);
    });
    it("late flag on a verified invoice locks the token and blocks financing", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toVerified(c);
      await c.reg.connect(c.operator).flagInvoice(id, h("late alert"));
      expect(await c.token.locked(id)).to.equal(true);
      await expect(c.reg.connect(c.supplier).requestFinancing(id, 9000)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
      await c.reg.connect(c.admin).clearFlag(id, Risk.LOW);
      expect(await c.token.locked(id)).to.equal(false);
      await c.reg.connect(c.supplier).requestFinancing(id, 9000);
    });
    it("risk cannot be re-assessed once an invoice is verified", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toVerified(c);
      await expect(c.reg.connect(c.operator).setRiskAssessment(id, Risk.LOW, h("r"))).to.be.revertedWithCustomError(c.reg, "WrongStatus");
    });
  });

  describe("financing", () => {
    it("supplier requests financing, token locks, transfers are blocked", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toRequested(c);
      expect(await c.token.locked(id)).to.equal(true);
      await expect(c.token.connect(c.supplier).transferFrom(c.supplier.address, c.stranger.address, id))
        .to.be.revertedWithCustomError(c.token, "TokenLocked");
    });
    it("token can be transferred while NOT in financing, but then financing needs supplier to hold it", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toVerified(c);
      await c.token.connect(c.supplier).transferFrom(c.supplier.address, c.stranger.address, id);
      await expect(c.reg.connect(c.supplier).requestFinancing(id, 9000))
        .to.be.revertedWithCustomError(c.reg, "NotEligible");
      await c.token.connect(c.stranger).transferFrom(c.stranger.address, c.supplier.address, id);
      await c.reg.connect(c.supplier).requestFinancing(id, 9000);
    });
    it("validates advance rate and who may request", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toVerified(c);
      await expect(c.reg.connect(c.stranger).requestFinancing(id, 9000)).to.be.revertedWithCustomError(c.reg, "NotSupplier");
      await expect(c.reg.connect(c.supplier).requestFinancing(id, 9999)).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(c.reg.connect(c.supplier).requestFinancing(id, 100)).to.be.revertedWithCustomError(c.reg, "InvalidInput");
    });
    it("cannot request financing for an unverified invoice", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await register(c);
      await expect(c.reg.connect(c.supplier).requestFinancing(id, 9000)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
    });
    it("supplier can cancel a request and unlock the token", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toRequested(c);
      await c.reg.connect(c.supplier).cancelFinancingRequest(id);
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.VERIFIED);
      expect(await c.token.locked(id)).to.equal(false);
    });
    it("only FINANCIER_ROLE can fund and funds move to the supplier", async () => {
      const c = await loadFixture(deployFixture);
      const { id, advance } = await toRequested(c).then(async (r) => ({ ...r, advance: (r.args.amount * 9000n) / 10000n }));
      await c.usd.connect(c.stranger).approve(await c.reg.getAddress(), advance);
      await expect(c.reg.connect(c.stranger).approveFinancing(id)).to.be.reverted;
      await c.usd.connect(c.financier).approve(await c.reg.getAddress(), advance);
      const before = await c.usd.balanceOf(c.supplier.address);
      await expect(c.reg.connect(c.financier).approveFinancing(id)).to.emit(c.reg, "FinancingApproved");
      expect(await c.usd.balanceOf(c.supplier.address)).to.equal(before + advance);
      const inv = await c.reg.getInvoiceDetails(id);
      expect(inv.status).to.equal(Status.FINANCED);
      expect(inv.financier).to.equal(c.financier.address);
      expect(inv.financedAmount).to.equal(advance);
      expect(inv.repayAmount).to.equal(USD(10_000));
    });
    it("fails cleanly without allowance", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toRequested(c);
      await expect(c.reg.connect(c.financier).approveFinancing(id)).to.be.reverted;
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.FINANCING_REQUESTED);
    });
    it("prevents double financing by the same or another financier", async () => {
      const c = await loadFixture(deployFixture);
      const { id, advance } = await toFinanced(c);
      await c.usd.connect(c.financier).approve(await c.reg.getAddress(), advance * 2n);
      await c.usd.connect(c.financier2).approve(await c.reg.getAddress(), advance * 2n);
      await expect(c.reg.connect(c.financier).approveFinancing(id)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
      await expect(c.reg.connect(c.financier2).approveFinancing(id)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
      await expect(c.reg.connect(c.supplier).requestFinancing(id, 9000)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
    });
    it("cannot re-register a financed invoice to finance it again", async () => {
      const c = await loadFixture(deployFixture);
      const { args } = await toFinanced(c);
      const t = await nowTs();
      await expect(
        c.reg.connect(c.supplier).registerInvoice(c.buyer.address, args.amount, t - 10n, t + 1000n, args.docHash, args.numberHash, "cid")
      ).to.be.revertedWithCustomError(c.reg, "DuplicateInvoice");
    });
    it("financier cannot be a party to the invoice", async () => {
      const c = await loadFixture(deployFixture);
      const r = await toRequested(c);
      await c.reg.connect(c.operator).grantRole(await c.reg.FINANCIER_ROLE(), c.buyer.address);
      await c.usd.connect(c.buyer).approve(await c.reg.getAddress(), USD(10_000));
      await expect(c.reg.connect(c.buyer).approveFinancing(r.id)).to.be.revertedWithCustomError(c.reg, "InvalidInput");
    });
    it("cannot cancel an invoice after financing", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toFinanced(c);
      await expect(c.reg.connect(c.supplier).cancelInvoice(id)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
    });
    it("cancelling a verified invoice burns the token and frees keys", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toVerified(c);
      await c.reg.connect(c.supplier).cancelInvoice(id);
      await expect(c.token.ownerOf(id)).to.be.reverted;
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.CANCELLED);
    });
  });

  describe("repayment & settlement", () => {
    it("records partial then full repayment, pays the financier, burns the token on settlement", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toFinanced(c);
      const reg = await c.reg.getAddress();
      await c.usd.connect(c.buyer).approve(reg, USD(10_000));
      const fBefore = await c.usd.balanceOf(c.financier.address);

      await expect(c.reg.connect(c.stranger).recordRepayment(id, USD(1))).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(c.reg.connect(c.buyer).recordRepayment(id, 0)).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await c.reg.connect(c.buyer).recordRepayment(id, USD(4_000));
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.FINANCED);
      await expect(c.reg.connect(c.buyer).recordRepayment(id, USD(7_000))).to.be.revertedWithCustomError(c.reg, "InvalidInput");
      await expect(c.reg.connect(c.buyer).recordRepayment(id, USD(6_000))).to.emit(c.reg, "InvoiceRepaid");
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.REPAID);
      expect(await c.usd.balanceOf(c.financier.address)).to.equal(fBefore + USD(10_000));

      await expect(c.reg.connect(c.stranger).markAsPaid(id)).to.be.revertedWithCustomError(c.reg, "NotFinancier");
      await c.reg.connect(c.financier).markAsPaid(id);
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.CLOSED);
      await expect(c.token.ownerOf(id)).to.be.reverted;
      await expect(c.reg.connect(c.buyer).recordRepayment(id, 1)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
    });
    it("cannot mark as paid before full repayment", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toFinanced(c);
      await expect(c.reg.connect(c.financier).markAsPaid(id)).to.be.revertedWithCustomError(c.reg, "WrongStatus");
    });
    it("supplier may repay as recourse, and overdue is reported", async () => {
      const c = await loadFixture(deployFixture);
      const { id } = await toFinanced(c);
      expect(await c.reg.isOverdue(id)).to.equal(false);
      await time.increase(61 * 86400);
      expect(await c.reg.isOverdue(id)).to.equal(true);
      await c.usd.connect(c.supplier).approve(await c.reg.getAddress(), USD(10_000));
      await c.reg.connect(c.supplier).recordRepayment(id, USD(10_000));
      expect(await c.reg.getInvoiceStatus(id)).to.equal(Status.REPAID);
    });
  });

  describe("pause", () => {
    it("admin can pause registration and financing", async () => {
      const c = await loadFixture(deployFixture);
      await expect(c.reg.connect(c.stranger).pause()).to.be.reverted;
      await c.reg.connect(c.admin).pause();
      const t = await nowTs();
      await expect(
        c.reg.connect(c.supplier).registerInvoice(c.buyer.address, USD(1), t - 10n, t + 1000n, h("p"), h("q"), "cid")
      ).to.be.revertedWithCustomError(c.reg, "EnforcedPause");
      await c.reg.connect(c.admin).unpause();
    });
  });

  describe("reentrancy", () => {
    it("blocks re-entry into approveFinancing from a hostile payment token", async () => {
      const [admin, operator, supplier, buyer] = await ethers.getSigners();
      const Evil = await ethers.getContractFactory("ReentrantToken");
      const evil = await Evil.deploy();
      const Token = await ethers.getContractFactory("InvoiceToken");
      const token = await Token.deploy(admin.address);
      const Registry = await ethers.getContractFactory("InvoiceRegistry");
      const reg = await Registry.deploy(admin.address, await evil.getAddress(), await token.getAddress());
      await token.setRegistry(await reg.getAddress());
      await reg.grantRole(await reg.OPERATOR_ROLE(), operator.address);
      await reg.connect(operator).grantRole(await reg.SUPPLIER_ROLE(), supplier.address);
      await reg.connect(operator).grantRole(await reg.FINANCIER_ROLE(), await evil.getAddress());
      await evil.mint(await evil.getAddress(), USD(1_000_000));

      const t = await nowTs();
      await reg.connect(supplier).registerInvoice(buyer.address, USD(1000), t - 10n, t + 100000n, h("d"), h("n"), "cid");
      await reg.connect(operator).setRiskAssessment(1, Risk.LOW, h("r"));
      await reg.connect(supplier).submitForVerification(1);
      await reg.connect(buyer).verifyInvoice(1);
      await reg.connect(supplier).requestFinancing(1, 9000);

      await evil.arm(await reg.getAddress(), 1);
      await evil.fund(await reg.getAddress(), 1);

      expect(await evil.reentryAttempted()).to.equal(true);
      expect(await evil.reentryBlocked()).to.equal(true);
      expect(await evil.reentryErrorSelector()).to.equal(ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10));
      expect(await reg.getInvoiceStatus(1)).to.equal(Status.FINANCED);
      expect(await evil.balanceOf(supplier.address)).to.equal(USD(900)); // paid exactly once
    });
  });
});
