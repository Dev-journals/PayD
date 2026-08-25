# vesting_escrow test fixtures

`upgraded_vesting.wasm` is the contract that `vesting_escrow`'s upgrade tests
upgrade _to_. Having a real, second executable is what makes the
"storage is preserved across upgrades" test meaningful: after the WASM swap the
tests talk to the contract through this fixture's client, so any change to the
storage layout would show up as a decoding failure rather than passing silently.

The fixture re-declares `VestingConfig` and `DataKey` exactly as `vesting_escrow`
declares them, and adds a `version()` entry point that only exists here — tests
call it to prove the executable really changed.

The `.wasm` is committed so `cargo test` works with no extra toolchain setup.

## Rebuilding

Only needed when `upgraded_vesting/src/lib.rs` changes:

```sh
cargo build --release --target wasm32v1-none \
  --manifest-path contracts/vesting_escrow/test_fixtures/upgraded_vesting/Cargo.toml

cp contracts/vesting_escrow/test_fixtures/upgraded_vesting/target/wasm32v1-none/release/upgraded_vesting.wasm \
   contracts/vesting_escrow/test_fixtures/upgraded_vesting.wasm
```

`upgraded_vesting` is excluded from the root workspace (see the `exclude` key in
the top-level `Cargo.toml`), so `stellar-scaffold build` and the contract release
workflow ignore it.
