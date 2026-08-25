#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

// ── Error codes ───────────────────────────────────────────────────────────────
//   AlreadyInitialized = 1  → Error(Contract, #1)
//   NotInitialized     = 2  → Error(Contract, #2)
//   Unauthorized       = 3  → Error(Contract, #3)
//   PaymentNotFound    = 4  → Error(Contract, #4)
//   InvalidAmount      = 5  → Error(Contract, #5)
//   NotPending         = 6  → Error(Contract, #6)
//   InvalidFeeRate     = 7  → Error(Contract, #7)

// ── Helpers ───────────────────────────────────────────────────────────────────

struct Setup {
    env: Env,
    sender: Address,
    token: Address,
    admin: Address,
    contract_id: Address,
    client: CrossAssetPaymentContractClient<'static>,
}

fn setup(fee_rate_bps: u32) -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let sender = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&sender, &100_000);

    let admin = Address::generate(&env);
    let contract_id = env.register(CrossAssetPaymentContract, ());
    let client = CrossAssetPaymentContractClient::new(&env, &contract_id);
    client.init(&admin, &fee_rate_bps);

    Setup { env, sender, token, admin, contract_id, client }
}

fn initiate(s: &Setup, amount: i128) -> u64 {
    s.client.initiate_payment(
        &s.sender,
        &amount,
        &s.token,
        &String::from_str(&s.env, "worker-1"),
        &String::from_str(&s.env, "EUR"),
        &String::from_str(&s.env, "anchor-eu"),
    )
}

// ── init ──────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_init_panics() {
    let s = setup(0);
    s.client.init(&s.admin, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_init_fee_above_cap_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(CrossAssetPaymentContract, ());
    let client = CrossAssetPaymentContractClient::new(&env, &contract_id);
    client.init(&admin, &1001); // > 10 %
}

// ── initiate_payment ──────────────────────────────────────────────────────────

#[test]
fn test_initiate_payment_zero_fee() {
    let s = setup(0);
    let tc = TokenClient::new(&s.env, &s.token);

    let id = initiate(&s, 500);
    assert_eq!(id, 1);

    // Full amount held in escrow; no fee taken
    assert_eq!(tc.balance(&s.contract_id), 500);
    assert_eq!(tc.balance(&s.sender), 99_500);

    let record = s.client.get_payment(&id).unwrap();
    assert_eq!(record.amount, 500);
    assert_eq!(record.net_amount, 500);
    assert_eq!(record.status, symbol_short!("pending"));
}

#[test]
fn test_initiate_payment_with_fee() {
    let s = setup(100); // 1 %
    let tc = TokenClient::new(&s.env, &s.token);

    let id = initiate(&s, 10_000);

    // fee = 10_000 * 100 / 10_000 = 100
    let record = s.client.get_payment(&id).unwrap();
    assert_eq!(record.amount, 10_000);
    assert_eq!(record.net_amount, 9_900);

    assert_eq!(tc.balance(&s.contract_id), 9_900);
    assert_eq!(tc.balance(&s.admin), 100);
    assert_eq!(tc.balance(&s.sender), 90_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_initiate_zero_amount_panics() {
    let s = setup(0);
    s.client.initiate_payment(
        &s.sender,
        &0,
        &s.token,
        &String::from_str(&s.env, "r"),
        &String::from_str(&s.env, "EUR"),
        &String::from_str(&s.env, "anc"),
    );
}

#[test]
fn test_payment_count_increments() {
    let s = setup(0);
    assert_eq!(s.client.get_payment_count(), 0);
    for i in 1..=3u64 {
        initiate(&s, 100);
        assert_eq!(s.client.get_payment_count(), i);
    }
}

// ── update_status ─────────────────────────────────────────────────────────────

#[test]
fn test_update_status() {
    let s = setup(0);
    let id = initiate(&s, 500);

    s.client.update_status(&id, &symbol_short!("success"));

    let record = s.client.get_payment(&id).unwrap();
    assert_eq!(record.status, symbol_short!("success"));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_update_status_not_found_panics() {
    let s = setup(0);
    s.client.update_status(&999, &symbol_short!("success"));
}

// ── cancel_payment ────────────────────────────────────────────────────────────

#[test]
fn test_cancel_refunds_net_amount() {
    let s = setup(200); // 2 %
    let tc = TokenClient::new(&s.env, &s.token);

    let id = initiate(&s, 10_000);
    // fee = 200, so net_amount = 9_800 held in contract
    let before = tc.balance(&s.sender);

    s.client.cancel_payment(&s.sender, &id);

    assert_eq!(tc.balance(&s.sender), before + 9_800);
    assert_eq!(tc.balance(&s.contract_id), 0);

    let record = s.client.get_payment(&id).unwrap();
    assert_eq!(record.status, symbol_short!("cancelled"));
}

#[test]
fn test_admin_can_cancel() {
    let s = setup(0);
    let id = initiate(&s, 500);
    // Admin cancels on behalf of sender; refund still goes to sender
    s.client.cancel_payment(&s.admin, &id);
    let record = s.client.get_payment(&id).unwrap();
    assert_eq!(record.status, symbol_short!("cancelled"));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_cancel_non_pending_panics() {
    let s = setup(0);
    let id = initiate(&s, 500);
    s.client.update_status(&id, &symbol_short!("success"));
    s.client.cancel_payment(&s.sender, &id);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_cancel_not_found_panics() {
    let s = setup(0);
    s.client.cancel_payment(&s.sender, &999);
}
