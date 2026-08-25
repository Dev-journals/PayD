#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec, token, Symbol};
use common::CommonError;

#[cfg(test)]
mod test;

#[contracttype]
pub enum DataKey {
    Admin,
    Recipients,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    EmptyRecipients = 4,
    DuplicateRecipient = 5,
    SharesMustSumToTotal = 6,
    InvalidAmount = 7,
}

impl From<CommonError> for ContractError {
    fn from(e: CommonError) -> Self {
        match e {
            CommonError::AlreadyInitialized => ContractError::AlreadyInitialized,
            CommonError::NotInitialized => ContractError::NotInitialized,
            CommonError::Unauthorized => ContractError::Unauthorized,
        }
    }
}

#[derive(Clone)]
#[contracttype]
pub struct RecipientShare {
    pub destination: Address,
    pub basis_points: u32,
}

pub const TOTAL_BASIS_POINTS: u32 = 10000; // 100%

#[contract]
pub struct RevenueSplitContract;

#[contractimpl]
impl RevenueSplitContract {
    /// Initialize the contract with an admin and an initial set of recipients/shares.
    pub fn init(env: Env, admin: Address, shares: Vec<RecipientShare>) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        // Ensure the provided admin signs initialization.
        admin.require_auth();

        Self::validate_shares(&env, &shares)?;

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Recipients, &shares);
        Ok(())
    }

    /// Allows the current admin to set a new admin.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), ContractError> {
        common::require_admin(&env, &DataKey::Admin).map_err(ContractError::from)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    /// Updates the recipient splits dynamically (admin only).
    pub fn update_recipients(env: Env, new_shares: Vec<RecipientShare>) -> Result<(), ContractError> {
        common::require_admin(&env, &DataKey::Admin).map_err(ContractError::from)?;

        Self::validate_shares(&env, &new_shares)?;

        env.storage().instance().set(&DataKey::Recipients, &new_shares);
        Ok(())
    }

    /// Distributes multiple assets from a sender to the listed recipients based on their shares.
    pub fn distribute(env: Env, from: Address, assets: Vec<(Address, i128)>) -> Result<(), ContractError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }

        from.require_auth();

        let shares: Vec<RecipientShare> = env
            .storage()
            .instance()
            .get(&DataKey::Recipients)
            .ok_or(ContractError::NotInitialized)?;

        for asset_pair in assets.iter() {
            let token = asset_pair.0;
            let amount = asset_pair.1;

            if amount <= 0 {
                return Err(ContractError::InvalidAmount);
            }

            let client = token::Client::new(&env, &token);

            let mut amount_distributed = 0;

            for (i, share) in shares.iter().enumerate() {
                // Calculate slice of the total amount using basis points
                // Formula: amount * basis_points / 10000
                let recipient_amount = (amount as i128 * share.basis_points as i128) / TOTAL_BASIS_POINTS as i128;
                
                if recipient_amount > 0 {
                    // To avoid precision loss dust, the last recipient takes any minor remainders.
                    if i as u32 == shares.len() - 1 {
                        let final_amount = amount - amount_distributed;
                        if final_amount > 0 {
                            client.transfer(&from, &share.destination, &final_amount);
                        }
                    } else {
                        client.transfer(&from, &share.destination, &recipient_amount);
                        amount_distributed += recipient_amount;
                    }
                }
            }

            env.events().publish((Symbol::new(&env, "distribute"), token.clone()), amount);
        }

        Ok(())
    }

    fn validate_shares(env: &Env, shares: &Vec<RecipientShare>) -> Result<(), ContractError> {
        if shares.len() == 0 {
            return Err(ContractError::EmptyRecipients);
        }

        let mut total_bp: u32 = 0;
        let mut seen: Vec<Address> = Vec::new(env);

        for share in shares.iter() {
            total_bp = total_bp.wrapping_add(share.basis_points);

            // Prevent duplicates; duplicates create ambiguity and can cause unexpected dust behavior.
            for addr in seen.iter() {
                if addr == share.destination {
                    return Err(ContractError::DuplicateRecipient);
                }
            }
            seen.push_back(share.destination.clone());
        }

        if total_bp != TOTAL_BASIS_POINTS {
            return Err(ContractError::SharesMustSumToTotal);
        }

        Ok(())
    }
}
