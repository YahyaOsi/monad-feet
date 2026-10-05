# Monad Feet V2 deployment verification

## Evidence

- Deployment: `0x616929D84ED483a26a568fC97A364e5c5eCBe39D`
- Network: Monad Mainnet, RPC chain ID 143.
- Source: user's complete pasted Solidity, preserved in `contracts/MonadFeetV2.sol`. The old `contracts/MonadFeet.sol` was not changed.
- The uploaded `0_MonadFeet_1790714057669.json` is actually a saved Remix MHTML webpage with truncated visible JSON. It was not treated as a valid compiler artifact.
- Compiler: official `soljson-v0.8.34+commit.80d5c536.js`.
- Settings producing the match: optimizer **disabled**, runs 200, EVM **Osaka**, no via-IR.
- Runtime length: 14,601 bytes.
- Immutable treasury: `0x23B4C6DdcA73ba99045E1c0Def939BD41932E773`, inserted into compiler immutable references at byte offsets 3298, 3751, and 4889 (32 bytes each).
- At block `0x6813e7a`, **all executable runtime bytes matched** after the immutable substitutions and removal of the Solidity CBOR metadata trailer.
- Full runtime does not match byte-for-byte because metadata differs. This is executable source equivalence, not a claim of exact source metadata or explorer verification.
- Live full-runtime Keccak-256: `0x0e57820b5da0dce2e9154720eb1fcfccaf7cf80e0578ec190b8d53c0fd331678`.
- Live executable-only Keccak-256: `0x9fed459d0f653d43fd8fd3a3a7714700c3f914c8d20f2bb066aa3f3f43b56b06`.
- Compiler-generated ABI: `contracts/MonadFeetV2.abi.json`.

## Reproduce

Download the official Solidity compiler asset to a temporary directory:

```sh
curl -fLsS 'https://binaries.soliditylang.org/wasm/soljson-v0.8.34+commit.80d5c536.js' -o /tmp/monad-soljson-0.8.34.cjs
node scripts/verify-monad-v2.cjs /tmp/monad-soljson-0.8.34.cjs
node scripts/test-monad-v2.cjs /tmp/monad-soljson-0.8.34.cjs
```

Verification regenerates the ABI after a successful match. Scripts use the API workspace's installed viem dependency. Test harness compilation uses via-IR and optimizer solely for the ephemeral probe; deployment source comparison uses the settings above.

## Read-only behavioral tests

25 simulations passed at block `0x6813fd3`. Tests used mainnet `eth_call` and `debug_traceCall` with ephemeral account/storage/code overrides, not transactions. No signing key, deployment, payment, database modification, or persisted chain change occurred. Except the explicit rejecting-treasury test, simulations retained the live treasury delegation and exercised its current receive behavior.

Validated:

- Action 1: exactly 1.43 MON, initial 5 points; ten purchases total 5,115 points.
- Action 2: exactly 14.3 MON, initial 7 points; ten purchases total 7,161 points.
- Action 3: exactly 143 MON, initial 15 points; ten purchases total 15,345 points.
- Points double per item purchase within a UTC day.
- Each item's eleventh same-day purchase reverts.
- Each item's one-wei underpayment and overpayment revert.
- New UTC day resets all three counters while preserving lifetime purchases.
- Item limits are independent.
- Unregistered callers and invalid actions revert.
- Treasury receives the full game fee; a rejecting treasury reverts the call.
- Trace logs show zero `InviteEarned` events for four purchases, one for five, and two for ten.
- Game purchases leave daily streak and last-check-in unchanged.
- Subscription 1 MON payment splits 0.88 MON to creator and 0.12 MON to treasury.
- A one-wei subscription **also succeeds** for a registered creator, demonstrating no on-chain creator-price enforcement.

## Boundaries and risks

1. **Not an audit or explorer verification.** Bytecode equivalence and deterministic simulations do not establish absence of vulnerabilities or guarantee future recipient behavior.
2. **Delegated treasury.** The treasury's runtime was `0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b`, an EIP-7702 delegation to `0x63c0c19a282a1b52b07dd5a65b58948a07dae32b`. The treasury address is immutable in the registry, but its delegated execution behavior is not proven immutable. Plain MON reception succeeded during these simulations; that is not assurance about other entrypoints or later delegation changes.
3. **External-call/reentrancy surface.** Game fees and subscription payouts use unrestricted-gas low-level calls, with no reentrancy guard. Game daily counters are incremented before the treasury call, but lifetime count, points, and events are updated afterward. Subscription expiry is updated after recipient calls. No exploit is asserted by these tests; nested callbacks and delegated/contract recipients merit independent audit and conservative receipt handling.
4. **Invite event only.** Every fifth lifetime game purchase emits `InviteEarned`. No usable invite code is minted/stored by the contract. The app must verify the correct deployment, successful transaction, sender, calldata, value and event, then issue codes once using durable replay protection.
5. **Separate streak action.** Games add `streakPoints`, not `currentStreak` or `lastCheckin`. `dailyCheckin()` remains separate.
6. **Subscription prices are not enforced on chain.** Any positive value works for a registered, non-self creator. The app must enforce its current price during receipt verification; external callers may still buy a contract-level subscription for one wei. Do not authorize private content from `isSubscribed` alone. Renewals replace expiry with transaction timestamp plus 30 days rather than extending an existing expiry.
7. **Registration invitations are off chain.** `registerUser` ignores `inviteCode`, does not enforce username uniqueness, and does not prove app admission. Server invite validation remains necessary.
8. **No automatic migration.** This deployment has independent state. Existing registry accounts, anchored posts, subscriptions, and verification evidence cannot be relabeled as V2 state. The verification scripts do not migrate anything.