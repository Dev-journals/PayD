#![cfg(test)]

use crate::{RevenueSplitContract, RevenueSplitContractClient, RecipientShare};
use soroban_sdk::{testutils::{Address as _}, Address, Env, Vec};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;

fn create_token_contract<'a>(e: &Env, admin: &Address) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    e.mock_all_auths();
    let contract_id = e.register_stellar_asset_contract_v2(admin.clone()).address();
    let stellar_asset_client = StellarAssetClient::new(e, &contract_id);
    let token_client = TokenClient::new(e, &contract_id);
    (contract_id, stellar_asset_client, token_client)
}

#[test]
fn test_distribution_invalid_amount_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(RevenueSplitContract, ());
    let contract_client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let shares = Vec::from_array(&env, [RecipientShare { destination: recipient1.clone(), basis_points: 10000 }]);
    contract_client.init(&admin, &shares);

    let sender = Address::generate(&env);
    stellar_asset_client.mint(&sender, &1000);

    let assets = Vec::from_array(&env, [(token_id.clone(), 0i128)]);
    assert!(contract_client.try_distribute(&sender, &assets).is_err());
    assert_eq!(token_client.balance(&sender), 1000);
}

#[test]
fn test_initialization() {
    let env = Env::default();
    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 6000 },
        RecipientShare { destination: recipient2.clone(), basis_points: 4000 },
    ]);

    env.mock_all_auths();
    client.init(&admin, &shares);

    // Initialized correctly without panic
}

#[test]
fn test_init_invalid_shares() {
    let env = Env::default();
    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);

    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
    ]);

    env.mock_all_auths();
    assert!(client.try_init(&admin, &shares).is_err());
}

#[test]
fn test_init_empty_recipients_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let shares = Vec::<RecipientShare>::new(&env);

    assert!(client.try_init(&admin, &shares).is_err());
}

#[test]
fn test_init_duplicate_recipient_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);

    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
    ]);

    assert!(client.try_init(&admin, &shares).is_err());
}

#[test]
#[should_panic]
fn test_init_requires_admin_auth() {
    let env = Env::default();
    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let shares = Vec::from_array(&env, [RecipientShare { destination: recipient1, basis_points: 10000 }]);

    // No mock auths => require_auth should panic
    client.init(&admin, &shares);
}

#[test]
fn test_distribution() {
    let env = Env::default();
    env.mock_all_auths();

    // Create token
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    // Setup revenue split contract
    let contract_id = env.register(RevenueSplitContract, ());
    let contract_client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let recipient3 = Address::generate(&env);

    // 50%, 30%, 20%
    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
        RecipientShare { destination: recipient2.clone(), basis_points: 3000 },
        RecipientShare { destination: recipient3.clone(), basis_points: 2000 },
    ]);

    contract_client.init(&admin, &shares);

    // Fund a sender
    let sender = Address::generate(&env);
    stellar_asset_client.mint(&sender, &1000);

    // Distribute 1000 tokens
    let assets = Vec::from_array(&env, [(token_id.clone(), 1000i128)]);
    contract_client.distribute(&sender, &assets);

    // Verify balances
    assert_eq!(token_client.balance(&sender), 0);
    assert_eq!(token_client.balance(&recipient1), 500);
    assert_eq!(token_client.balance(&recipient2), 300);
    assert_eq!(token_client.balance(&recipient3), 200);
}

#[test]
fn test_distribution_multiple_assets() {
    let env = Env::default();
    env.mock_all_auths();

    // Create tokens
    let token_admin = Address::generate(&env);
    let (token_id1, stellar_asset_client1, token_client1) = create_token_contract(&env, &token_admin);
    let (token_id2, stellar_asset_client2, token_client2) = create_token_contract(&env, &token_admin);

    // Setup revenue split contract
    let contract_id = env.register(RevenueSplitContract, ());
    let contract_client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    // 60%, 40%
    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 6000 },
        RecipientShare { destination: recipient2.clone(), basis_points: 4000 },
    ]);

    contract_client.init(&admin, &shares);

    // Fund a sender
    let sender = Address::generate(&env);
    stellar_asset_client1.mint(&sender, &1000);
    stellar_asset_client2.mint(&sender, &2000);

    // Distribute multiple assets
    let assets = Vec::from_array(&env, [
        (token_id1.clone(), 1000i128),
        (token_id2.clone(), 2000i128)
    ]);
    contract_client.distribute(&sender, &assets);

    // Verify balances token 1
    assert_eq!(token_client1.balance(&sender), 0);
    assert_eq!(token_client1.balance(&recipient1), 600);
    assert_eq!(token_client1.balance(&recipient2), 400);

    // Verify balances token 2
    assert_eq!(token_client2.balance(&sender), 0);
    assert_eq!(token_client2.balance(&recipient1), 1200);
    assert_eq!(token_client2.balance(&recipient2), 800);
}

#[test]
fn test_update_recipients() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RevenueSplitContract, ());
    let client = RevenueSplitContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    
    // Initial 100% to recipient1
    let shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 10000 },
    ]);
    client.init(&admin, &shares);

    // Update to 2 recipients perfectly
    let recipient2 = Address::generate(&env);
    let new_shares = Vec::from_array(&env, [
        RecipientShare { destination: recipient1.clone(), basis_points: 5000 },
        RecipientShare { destination: recipient2.clone(), basis_points: 5000 },
    ]);

    client.update_recipients(&new_shares);
}
