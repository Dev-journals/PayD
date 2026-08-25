#![no_std]
//! Upgrade target used by `vesting_escrow`'s upgrade tests.
//!
//! It re-declares `VestingConfig` and `DataKey` byte-for-byte as they appear in
//! `vesting_escrow`, so reading the pre-upgrade config back through this
//! contract proves the storage layout survived the WASM swap. `version()` is
//! the only new entry point — it exists so tests can tell, unambiguously, that
//! the executable really changed.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub struct VestingConfig {
    pub beneficiary: Address,
    pub token: Address,
    pub start_time: u64,
    pub cliff_seconds: u64,
    pub duration_seconds: u64,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub clawback_admin: Address,
    pub is_active: bool,
}

#[contracttype]
pub enum DataKey {
    Config,
    UpgradeAdmin,
    PendingUpgrade,
}

#[contract]
pub struct UpgradedVestingContract;

#[contractimpl]
impl UpgradedVestingContract {
    /// Present only in the upgraded executable.
    pub fn version(_e: Env) -> u32 {
        2
    }

    pub fn get_config(e: Env) -> VestingConfig {
        e.storage()
            .instance()
            .get(&DataKey::Config)
            .expect("Not initialized")
    }

    pub fn get_upgrade_admin(e: Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::UpgradeAdmin)
            .expect("Not initialized")
    }
}
