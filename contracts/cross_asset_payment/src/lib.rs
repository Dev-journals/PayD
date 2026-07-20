#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, contractevent,
    symbol_short, Address, Env, String, Symbol, token,
};
use common::CommonError;

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized     = 2,
    Unauthorized       = 3,
    PaymentNotFound    = 4,
    InvalidAmount      = 5,
    NotPending         = 6,
    InvalidFeeRate     = 7,
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

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct PaymentInitiatedEvent {
    pub payment_id: u64,
    pub from: Address,
    pub amount: i128,
    pub target_asset: String,
    pub anchor_id: String,
}

#[contractevent]
pub struct PaymentStatusUpdatedEvent {
    pub payment_id: u64,
    pub new_status: Symbol,
}

#[contractevent]
pub struct PaymentCancelledEvent {
    pub payment_id: u64,
    pub refunded_amount: i128,
}

// ── Storage types ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct PaymentRecord {
    pub from: Address,
    pub amount: i128,
    pub net_amount: i128,
    pub asset: Address,
    pub receiver_id: String,
    pub target_asset: String,
    pub anchor_id: String,
    pub status: Symbol,
}

#[contracttype]
pub enum DataKey {
    Admin,
    PaymentCount,
    FeeRateBps,
    Payment(u64),
}

// ~30 days at 5 s/ledger
const PAYMENT_TTL_LEDGERS: u32 = 518_400;
// Maximum protocol fee: 10%
const MAX_FEE_BPS: u32 = 1_000;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct CrossAssetPaymentContract;

#[contractimpl]
impl CrossAssetPaymentContract {
    pub fn init(env: Env, admin: Address, fee_rate_bps: u32) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        if fee_rate_bps > MAX_FEE_BPS {
            return Err(ContractError::InvalidFeeRate);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PaymentCount, &0u64);
        env.storage().instance().set(&DataKey::FeeRateBps, &fee_rate_bps);
        Ok(())
    }

    pub fn set_fee_rate(env: Env, fee_rate_bps: u32) -> Result<(), ContractError> {
        if fee_rate_bps > MAX_FEE_BPS {
            return Err(ContractError::InvalidFeeRate);
        }
        common::require_admin(&env, &DataKey::Admin).map_err(ContractError::from)?;
        env.storage().instance().set(&DataKey::FeeRateBps, &fee_rate_bps);
        Ok(())
    }

    /// Initiate a cross-asset payment. Pulls `amount` from `from`, sends the
    /// fee share to the admin immediately, and holds the net amount in escrow
    /// pending anchor confirmation.
    pub fn initiate_payment(
        env: Env,
        from: Address,
        amount: i128,
        asset: Address,
        receiver_id: String,
        target_asset: String,
        anchor_id: String,
    ) -> Result<u64, ContractError> {
        from.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        let fee_rate_bps: u32 = env.storage().instance()
            .get(&DataKey::FeeRateBps)
            .unwrap_or(0);

        let fee = (amount * fee_rate_bps as i128) / 10_000;
        let net_amount = amount - fee;

        let token_client = token::Client::new(&env, &asset);

        // Pull full amount from sender; route fee to admin immediately so the
        // contract only ever holds the escrowed net_amount.
        token_client.transfer(&from, &env.current_contract_address(), &amount);
        if fee > 0 {
            token_client.transfer(&env.current_contract_address(), &admin, &fee);
        }

        let count: u64 = env.storage().instance()
            .get(&DataKey::PaymentCount)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::PaymentCount, &count);

        let record = PaymentRecord {
            from: from.clone(),
            amount,
            net_amount,
            asset,
            receiver_id,
            target_asset: target_asset.clone(),
            anchor_id: anchor_id.clone(),
            status: symbol_short!("pending"),
        };

        // Persistent storage: survives ledger eviction across the TTL window.
        // Instance storage would cap total contract state; persistent entries
        // are independently evictable and scale to any payment volume.
        env.storage().persistent().set(&DataKey::Payment(count), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Payment(count),
            PAYMENT_TTL_LEDGERS,
            PAYMENT_TTL_LEDGERS,
        );

        PaymentInitiatedEvent {
            payment_id: count,
            from,
            amount,
            target_asset,
            anchor_id,
        };

        Ok(count)
    }

    /// Update the status of a payment (admin / anchor only).
    pub fn update_status(
        env: Env,
        payment_id: u64,
        new_status: Symbol,
    ) -> Result<(), ContractError> {
        common::require_admin(&env, &DataKey::Admin).map_err(ContractError::from)?;

        let mut record: PaymentRecord = env.storage().persistent()
            .get(&DataKey::Payment(payment_id))
            .ok_or(ContractError::PaymentNotFound)?;

        record.status = new_status.clone();
        env.storage().persistent().set(&DataKey::Payment(payment_id), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Payment(payment_id),
            PAYMENT_TTL_LEDGERS,
            PAYMENT_TTL_LEDGERS,
        );

        PaymentStatusUpdatedEvent { payment_id, new_status };

        Ok(())
    }

    /// Cancel a pending payment. Only the original sender or admin may cancel.
    /// Refunds the net amount (post-fee) to the sender; fees already sent to
    /// admin are non-refundable.
    pub fn cancel_payment(
        env: Env,
        caller: Address,
        payment_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        let mut record: PaymentRecord = env.storage().persistent()
            .get(&DataKey::Payment(payment_id))
            .ok_or(ContractError::PaymentNotFound)?;

        if record.status != symbol_short!("pending") {
            return Err(ContractError::NotPending);
        }

        if caller != record.from && caller != admin {
            return Err(ContractError::Unauthorized);
        }

        let refund = record.net_amount;
        record.status = symbol_short!("cancelled");
        env.storage().persistent().set(&DataKey::Payment(payment_id), &record);

        if refund > 0 {
            let token_client = token::Client::new(&env, &record.asset);
            token_client.transfer(&env.current_contract_address(), &record.from, &refund);
        }

        PaymentCancelledEvent { payment_id, refunded_amount: refund };

        Ok(())
    }

    pub fn get_payment(env: Env, payment_id: u64) -> Option<PaymentRecord> {
        env.storage().persistent().get(&DataKey::Payment(payment_id))
    }

    pub fn get_payment_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::PaymentCount).unwrap_or(0)
    }

}

mod test;
