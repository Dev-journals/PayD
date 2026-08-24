# Vesting Escrow Upgrades

`contracts/vesting_escrow` holds tokens on a schedule that can run for months or
years. A bug found mid-schedule used to be unfixable: there was no way to replace
the contract's code, so the only remedy was to claw back every grant and re-create
it under a new contract. This document describes the upgrade mechanism that
replaces that manual migration.

## Roles

The contract has two independent admins:

| Role             | Stored as                | Can do                                       |
| ---------------- | ------------------------ | -------------------------------------------- |
| `clawback_admin` | field of `VestingConfig` | Revoke the grant and reclaim unvested tokens |
| `upgrade_admin`  | `DataKey::UpgradeAdmin`  | Propose, cancel and execute WASM upgrades    |

Both are set at `initialize` time. They are deliberately separate: the employer
funding a grant should not automatically be able to swap out the escrow's code,
and the platform operating the escrow should not be able to revoke grants.

## The 48-hour timelock

An upgrade is a two-step process, and the two steps are separated by a mandatory
delay of `UPGRADE_TIMELOCK_SECONDS` (48 hours).

```
propose_upgrade(new_wasm_hash)
        │
        │  48 h — proposal is public on-chain, beneficiaries can observe
        │         it and claim vested tokens if they disagree
        ▼
execute_upgrade()  ──▶  the contract now runs new_wasm_hash
```

The delay is what makes upgradeability safe to grant at all: because the upgrade
admin can replace the code that governs beneficiary funds, beneficiaries need a
window in which they can see a pending change and react to it before it lands.

Timestamps come from the ledger and are Unix seconds in UTC, so the 48 hours are
exact wall-clock hours regardless of where the proposer is.

## Entry points

| Function                     | Auth          | Behaviour                                                          |
| ---------------------------- | ------------- | ------------------------------------------------------------------ |
| `propose_upgrade(wasm_hash)` | upgrade admin | Queues `wasm_hash` and returns the timestamp it becomes executable |
| `execute_upgrade()`          | upgrade admin | Swaps the contract's WASM; fails until the timelock has expired    |
| `cancel_upgrade()`           | upgrade admin | Drops the queued proposal                                          |
| `get_pending_upgrade()`      | none          | The queued `PendingUpgrade`, or `None`                             |
| `get_upgrade_admin()`        | none          | The upgrade admin address                                          |
| `get_upgrade_timelock()`     | none          | The timelock length in seconds                                     |

Errors: `Unauthorized`, `UpgradeAlreadyPending`, `NoPendingUpgrade`,
`TimelockNotExpired`.

### Only one proposal at a time

`propose_upgrade` fails with `UpgradeAlreadyPending` while a proposal is queued,
rather than overwriting it. Overwriting would let the admin substitute a
different WASM hash without restarting the clock, which would defeat the
timelock — a beneficiary who reviewed the queued hash could end up with an
entirely different one landing at the original deadline. To change the target,
call `cancel_upgrade` and propose again; the full 48 hours start over.

The queued proposal is also removed _before_ the WASM swap, so the new code never
inherits a stale proposal it could replay.

## Storage is preserved

`execute_upgrade` swaps only the contract's executable. Every storage entry —
`VestingConfig` (beneficiary, token, schedule, `claimed_amount`, clawback admin,
active flag), the upgrade admin, and the contract's token balance — is untouched,
so in-flight schedules keep vesting across the upgrade with no migration step.

New code must therefore keep `DataKey` and `VestingConfig` layout-compatible.
`contracts/vesting_escrow/test_fixtures/upgraded_vesting` is a second contract
that re-declares both types and is used as the upgrade target in tests: the tests
read the pre-upgrade config back through the _upgraded_ client, so a layout change
surfaces as a decoding failure instead of passing silently.

While an upgrade is pending, the contract also extends its instance TTL past the
timelock so the proposal cannot be archived before it can be executed.

## Events

All three upgrade steps emit an event, so an indexer or admin UI can surface a
pending upgrade to beneficiaries:

- `upgrade_proposed_event` — `wasm_hash`, `proposed_at`, `executable_at`
- `upgrade_executed_event` — `wasm_hash`, `executed_at`
- `upgrade_cancelled_event` — `wasm_hash`, `cancelled_at`

## Operating an upgrade

```sh
# 1. Upload the new WASM and note the returned hash
stellar contract upload --wasm vesting_escrow.wasm --source upgrade-admin --network testnet

# 2. Queue it (returns the timestamp at which it may be executed)
stellar contract invoke --id "$CONTRACT_ID" --source upgrade-admin --network testnet \
  -- propose_upgrade --new_wasm_hash "$WASM_HASH"

# 3. After 48 h have elapsed
stellar contract invoke --id "$CONTRACT_ID" --source upgrade-admin --network testnet \
  -- execute_upgrade
```

Out of scope for now: governance-controlled upgrades (multi-party approval of a
proposal) and upgrade-admin rotation.
