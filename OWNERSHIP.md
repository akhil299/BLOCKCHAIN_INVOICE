# Invoice token: ownership and transfer rules

InvoChain mints one **ERC-721 token per verified invoice**. This document states exactly what that token is, what it
is not, and the rules the smart contracts enforce. (Contracts: `InvoiceToken.sol`, `InvoiceRegistry.sol`.)

## What the token is
* A **technical receipt** that points at one invoice record in the registry. `tokenId == invoiceId`.
* Metadata is generated fully on-chain (`tokenURI`): invoice ID, document hash, supplier, status, amount, due date, lock state.
* Because the token ID equals the invoice ID, **two tokens can never represent the same invoice or financing claim**.

## What the token is NOT
* It is **not proof of legal ownership** of the underlying receivable. Whether a debt can be assigned, and to whom, is a
  matter of contract and local law, which a testnet token cannot decide.
* Holding or moving the token does **not** change who is paid. Financing proceeds always go to the **supplier of record**
  stored in the registry, and repayments always go to the **financier of record**.

## Lifecycle of the token
| Invoice status | Token | Transferable? |
|---|---|---|
| CREATED / PENDING_VERIFICATION | not minted yet | n/a |
| VERIFIED (buyer confirmed) | **minted to the supplier** | yes (but the supplier must hold it to request financing) |
| FLAGGED after verification | exists | **no** (locked until an admin clears the flag) |
| FINANCING_REQUESTED, FINANCED, REPAID | exists | **no** (locked, so it cannot be sold while a claim is active) |
| CLOSED (settled) | **burned** | n/a, the registry keeps the permanent history |
| CANCELLED after verification | **burned** | n/a |

## Rules enforced by the contracts
1. Only the registry can mint, lock, unlock or burn tokens (`NotRegistry` otherwise). Not even the deployer can.
2. Mint happens only when the **named buyer** verifies from their own wallet.
3. `requestFinancing` requires `ownerOf(token) == supplier`; it then locks the token.
4. While locked, `transferFrom`/`safeTransferFrom` revert with `TokenLocked`.
5. Cancelling the financing request unlocks it; full repayment plus `markAsPaid` burns it.
6. A second financing request or second funding of the same invoice is impossible: funding is a single atomic
   `FINANCING_REQUESTED -> FINANCED` transition inside a `nonReentrant` function.

## Why transfers outside financing are allowed at all
The assignment requires restricting transfers *while financing is active*. Outside that window a supplier may move the
token (e.g. to another wallet they control). Because financing requires the supplier to hold it, a token parked with
someone else simply blocks financing until it is returned. If you want stricter behaviour (soulbound until settled),
change `_update` in `InvoiceToken.sol` to always revert for non-mint/burn transfers.
