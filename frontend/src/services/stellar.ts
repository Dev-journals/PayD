import { Keypair, Operation, Asset, Claimant } from '@stellar/stellar-sdk';

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';

// Common Testnet Issuers (Mocked for this project)
export const USDC_ISSUER = 'GBBD67VFB9X7Z5D5C68A6E3F7D2B6C4A5S6D7F8G9H0J1K2L3M4N5O6P';
export const EURC_ISSUER = 'GDIHU6DHPR6N3H37N6Z6VHUY4FALN6Y7G8H9J0K1L2M3N4O5P6Q7R8S';

export interface ClaimableBalanceDetails {
  id: string;
  source: string;
  claimant: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
}

export const generateWallet = () => {
  const keypair = Keypair.random();
  return {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  };
};

/**
 * Checks if an account has a trustline for a given asset.
 */
export const checkTrustline = async (
  publicKey: string,
  assetCode: string,
  assetIssuer?: string
): Promise<boolean> => {
  if (!publicKey) return false;
  if (assetCode === 'XLM') return true; // Native asset always has a "trustline"

  try {
    const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (!response.ok) {
      if (response.status === 404) {
        // Account doesn't exist on network yet
        return false;
      }
      throw new Error(`Failed to fetch account: ${response.statusText}`);
    }
    const accountData = (await response.json()) as {
      balances: Array<{ asset_code?: string; asset_issuer?: string }>;
    };

    return accountData.balances.some(
      (balance) =>
        balance.asset_code === assetCode && (!assetIssuer || balance.asset_issuer === assetIssuer)
    );
  } catch (error) {
    console.error('Error checking trustline:', error);
    // In case of error (e.g. network down), we fallback to false for safety or true for demo
    return false;
  }
};

/**
 * Creates a Change Trust operation and returns the transaction details (simulated).
 * In a real app, this would build a full XDR to be signed by a wallet.
 */
export const createTrustlineTransaction = (
  publicKey: string,
  assetCode: string,
  assetIssuer: string
) => {
  try {
    const asset = new Asset(assetCode, assetIssuer);
    const operation = Operation.changeTrust({
      asset: asset,
    });

    // For demo purposes, we'll return a mock "success" and the operation
    return {
      success: true,
      operation,
      assetCode,
      publicKey,
    };
  } catch (error) {
    console.error('Error creating trustline transaction:', error);
    return { success: false, error };
  }
};

export const createClaimableBalanceTransaction = (
  sourceSecretKey: string,
  claimantPublicKey: string,
  amount: string,
  assetCode: string = 'USDC',
  assetIssuer?: string
) => {
  // Mock building the transaction as we don't have the full Stellar infrastructure initialized right now
  try {
    // We just parse the secret key to ensure it's valid if possible
    try {
      Keypair.fromSecret(sourceSecretKey);
    } catch {
      // Fallback for mocked employer secret
    }

    const asset =
      assetCode === 'XLM'
        ? Asset.native()
        : new Asset(assetCode, assetIssuer || Keypair.random().publicKey());

    const operation = Operation.createClaimableBalance({
      asset: asset,
      amount: amount,
      claimants: [
        new Claimant(
          claimantPublicKey,
          Claimant.predicateUnconditional() // Employee can claim whenever they want
        ),
      ],
    });

    console.log('Simulating Claimable Balance Operation:', operation);

    // Normally we would build this into a transaction, sign it, and submit it to Horizon.
    return {
      success: true,
      simulatedOperation: operation,
      amount,
      claimantPublicKey,
    };
  } catch (error) {
    console.error('Error creating claimable balance transaction:', error);
    return {
      success: false,
      error,
    };
  }
};
