#![no_std]

use soroban_sdk::{contracterror, Address, Env, IntoVal, Val};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum CommonError {
    AlreadyInitialized = 1,
    NotInitialized     = 2,
    Unauthorized       = 3,
}

/// Reads the admin address from instance storage at the given key, verifies the
/// caller has authorized this contract call, and returns the admin address.
pub fn require_admin<K: IntoVal<Env, Val>>(
    env: &Env,
    admin_key: &K,
) -> Result<Address, CommonError> {
    let admin: Address = env
        .storage()
        .instance()
        .get(admin_key)
        .ok_or(CommonError::NotInitialized)?;
    admin.require_auth();
    Ok(admin)
}
