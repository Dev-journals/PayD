#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, FromVal, Symbol, Vec,
};

// ── Errors map ────────────────────────────────────────────────────────────────
// Soroban host panics with "HostError: Error(Contract, #N)" — variant names
// are NOT in the panic string. Match on the numeric code instead:
//
//   AlreadyInitialized = 1  → Error(Contract, #1)
//   NotInitialized     = 2  → Error(Contract, #2)
//   EmptyBatch         = 4  → Error(Contract, #4)
//   BatchTooLarge      = 5  → Error(Contract, #5)
//   InvalidAmount      = 6  → Error(Contract, #6)
//   SequenceMismatch   = 8  → Error(Contract, #8)
//   BatchNotFound      = 9  → Error(Contract, #9)

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address, BulkPaymentContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let sender = Address::generate(&env);
    StellarAssetClient::new(&env, &token_id).mint(&sender, &1_000_000);

    let admin = Address::generate(&env);
    let contract_id = env.register(BulkPaymentContract,());
    let client = BulkPaymentContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    (env, sender, token_id, client)
}

fn setup_with_sender_balance(sender_balance: i128) -> (Env, Address, Address, BulkPaymentContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let sender = Address::generate(&env);
    StellarAssetClient::new(&env, &token_id).mint(&sender, &sender_balance);

    let admin = Address::generate(&env);
    let contract_id = env.register(BulkPaymentContract,());
    let client = BulkPaymentContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    (env, sender, token_id, client)
}

fn one_payment(env: &Env) -> Vec<PaymentOp> {
    let mut payments: Vec<PaymentOp> = Vec::new(env);
    payments.push_back(PaymentOp { recipient: Address::generate(env), amount: 10 });
    payments
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_initialize_twice_panics() {
    let (env, _, _, client) = setup();
    client.initialize(&Address::generate(&env));
}

// ── execute_batch ─────────────────────────────────────────────────────────────

#[test]
fn test_execute_batch_success() {
    let (env, sender, token, client) = setup();

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);

    let mut payments: Vec<PaymentOp> = Vec::new(&env);
    payments.push_back(PaymentOp { recipient: r1.clone(), amount: 100 });
    payments.push_back(PaymentOp { recipient: r2.clone(), amount: 200 });
    payments.push_back(PaymentOp { recipient: r3.clone(), amount: 300 });

    let batch_id = client.execute_batch(&sender, &token, &payments, &client.get_sequence());

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&r1), 100);
    assert_eq!(tc.balance(&r2), 200);
    assert_eq!(tc.balance(&r3), 300);

    let record = client.get_batch(&batch_id);
    assert_eq!(record.success_count, 3);
    assert_eq!(record.fail_count, 0);
    assert_eq!(record.total_sent, 600);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_execute_batch_empty_panics() {
    let (env, sender, token, client) = setup();
    let payments: Vec<PaymentOp> = Vec::new(&env);
    client.execute_batch(&sender, &token, &payments, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_execute_batch_too_large_panics() {
    let (env, sender, token, client) = setup();
    let mut payments: Vec<PaymentOp> = Vec::new(&env);
    for _ in 0..=100 {
        payments.push_back(PaymentOp { recipient: Address::generate(&env), amount: 1 });
    }
    client.execute_batch(&sender, &token, &payments, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_execute_batch_negative_amount_panics() {
    let (env, sender, token, client) = setup();
    let mut payments: Vec<PaymentOp> = Vec::new(&env);
    payments.push_back(PaymentOp { recipient: Address::generate(&env), amount: -5 });
    client.execute_batch(&sender, &token, &payments, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_execute_batch_amount_overflow_panics() {
    let (env, sender, token, client) = setup();
    let mut payments: Vec<PaymentOp> = Vec::new(&env);
    payments.push_back(PaymentOp { recipient: Address::generate(&env), amount: i128::MAX });
    payments.push_back(PaymentOp { recipient: Address::generate(&env), amount: 1 });
    client.execute_batch(&sender, &token, &payments, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_execute_batch_sequence_replay_panics() {
    let (env, sender, token, client) = setup();
    let payments = one_payment(&env);
    client.execute_batch(&sender, &token, &payments, &0); // seq → 1
    client.execute_batch(&sender, &token, &payments, &0); // must panic
}

#[test]
fn test_sequence_advances_after_each_batch() {
    let (env, sender, token, client) = setup();
    let payments = one_payment(&env);

    assert_eq!(client.get_sequence(), 0);
    client.execute_batch(&sender, &token, &payments, &0);
    assert_eq!(client.get_sequence(), 1);
    client.execute_batch(&sender, &token, &payments, &1);
    assert_eq!(client.get_sequence(), 2);
}

#[test]
fn test_batch_count_increments() {
    let (env, sender, token, client) = setup();
    let payments = one_payment(&env);

    client.execute_batch(&sender, &token, &payments, &0);
    client.execute_batch(&sender, &token, &payments, &1);

    assert_eq!(client.get_batch_count(), 2);
}

// ── execute_batch_partial ─────────────────────────────────────────────────────

#[test]
fn test_partial_batch_skips_insufficient_funds() {
    // With partial-mode semantics, the contract pulls up to the sender's current
    // balance (instead of the full requested total), then pays sequentially until
    // it can't cover the next payment.
    let (env, sender, token, client) = setup_with_sender_balance(600);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);

    let mut payments: Vec<PaymentOp> = Vec::new(&env);
    payments.push_back(PaymentOp { recipient: r1.clone(), amount: 500 });
    payments.push_back(PaymentOp { recipient: r2.clone(), amount: 400 });

    let batch_id =
        client.execute_batch_partial(&sender, &token, &payments, &client.get_sequence());

    let record = client.get_batch(&batch_id);
    assert_eq!(record.success_count, 1);
    assert_eq!(record.fail_count, 1);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&r1), 500);
    assert_eq!(tc.balance(&r2), 0);
    assert_eq!(tc.balance(&sender), 100); // refunded the unspent pull
}

#[test]
fn test_partial_batch_all_fail_status_is_rollbck() {
    let (env, sender, token, client) = setup();
    let mut payments: Vec<PaymentOp> = Vec::new(&env);
    payments.push_back(PaymentOp { recipient: Address::generate(&env), amount: -1 });

    let batch_id =
        client.execute_batch_partial(&sender, &token, &payments, &client.get_sequence());

    let record = client.get_batch(&batch_id);
    assert_eq!(record.success_count, 0);
    assert_eq!(record.fail_count, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_partial_batch_empty_panics() {
    let (env, sender, token, client) = setup();
    let payments: Vec<PaymentOp> = Vec::new(&env);
    client.execute_batch_partial(&sender, &token, &payments, &0);
}

// ── get_batch ─────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_get_batch_not_found_panics() {
    let (_, _, _, client) = setup();
    client.get_batch(&999);
}

// ── Event emission ────────────────────────────────────────────────────────────

fn has_event(env: &Env, contract_addr: &Address, event_name: &str) -> bool {
    let target_sym = Symbol::new(env, event_name);
    env.events().all().iter().any(|(addr, topics, _data)| {
        if addr != *contract_addr {
            return false;
        }
        topics.iter().any(|t| {
            let sym = Symbol::from_val(env, &t);
            sym == target_sym
        })
    })
}

#[test]
fn test_execute_batch_emits_batch_executed_event() {
    let (env, sender, token, client) = setup();
    let r1 = Address::generate(&env);

    let mut payments: Vec<PaymentOp> = Vec::new(&env);
    payments.push_back(PaymentOp { recipient: r1.clone(), amount: 100 });

    client.execute_batch(&sender, &token, &payments, &client.get_sequence());

    assert!(
        has_event(&env, &client.address, "batch_executed_event"),
        "BatchExecutedEvent was not emitted"
    );
}

#[test]
fn test_execute_batch_partial_emits_all_events() {
    let (env, sender, token, client) = setup_with_sender_balance(500);

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);

    let mut payments: Vec<PaymentOp> = Vec::new(&env);
    payments.push_back(PaymentOp { recipient: r1.clone(), amount: 500 });
    payments.push_back(PaymentOp { recipient: r2.clone(), amount: 400 });

    client.execute_batch_partial(&sender, &token, &payments, &client.get_sequence());

    assert!(
        has_event(&env, &client.address, "payment_sent_event"),
        "PaymentSentEvent was not emitted"
    );
    assert!(
        has_event(&env, &client.address, "payment_skipped_event"),
        "PaymentSkippedEvent was not emitted"
    );
    assert!(
        has_event(&env, &client.address, "batch_partial_event"),
        "BatchPartialEvent was not emitted"
    );
}