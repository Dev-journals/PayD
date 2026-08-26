import { xdr } from '@stellar/stellar-sdk';

export interface ContractErrorDetails {
  code: string;
  message: string;
  action: string;
  rawXdr?: string;
}

const ERROR_MAPPINGS: Record<string, { message: string; action: string }> = {
  // Custom Contract Error Codes (Example from a standard escrow/payroll contract)
  '1': {
    message: 'Unauthorized: The caller does not have permission for this action.',
    action: 'Verify you are signing with the correct administrator or employee account.',
  },
  '2': {
    message: 'Invalid State: The contract is not in the expected state (e.g., already claimed).',
    action: 'Refresh the page to see the latest status of this grant.',
  },
  '3': {
    message: 'Insufficient Funds: The contract or source account lacks required balance.',
    action: 'Ensure the source account has enough funds and try again.',
  },
  '4': {
    message: 'Deadline Passed: The time-locked window for this operation has closed.',
    action: 'Check the cliff and end dates for this vesting schedule.',
  },
  '5': {
    message: 'Already Initialized: This contract has already been configured.',
    action: 'If you need to change settings, you may need a new contract deployment.',
  },
  '6': {
    message: 'Cliff Not Reached: Tokens are still in the cliff period and cannot be claimed.',
    action: 'Wait until the cliff date has passed before attempting to claim.',
  },

  // Host/VASM Error Codes (ScErrorType)
  Contract: {
    message: 'Contract Logic Error: A custom error was thrown by the contract code.',
    action: 'Review the contract error code or contact the contract developer.',
  },
  WasmConfig: {
    message: 'WASM Config Error: The contract execution failed due to invalid WASM configuration.',
    action: 'This usually indicates a bug in the contract binary or host configuration.',
  },
  Context: {
    message: 'Execution Context Error: Failed to setup the internal contract environment.',
    action: 'Check if you have provided all required contract data and parameters.',
  },
  Storage: {
    message: 'Resource Storage Error: Error accessing contract persistent storage.',
    action: 'Verify the contract state exists on-chain and has not been archived.',
  },
  Object: {
    message: 'Host Object Error: Invalid host object handle or type mismatch.',
    action: 'Ensure all arguments passed to the contract call are correctly formatted ScVal types.',
  },
  Crypto: {
    message: 'Cryptographic Failure: Failed to verify signature or hash inside the contract.',
    action: 'Ensure all auth signatures are valid and cover the correct transaction footprint.',
  },
  Events: {
    message: 'Event Emission Failure: Contract exceeded the limit of allowed events.',
    action: 'Try to reduce the amount of data being processed in a single call.',
  },
  Budget: {
    message: 'Resource Budget Exceeded: The operation exceeded CPU or Memory limits.',
    action: 'Increase the transaction resource limits (CPU/Memory) and retry.',
  },
  Auth: {
    message: 'Contract Authentication Error: Failed to satisfy Soroban authorization requirements.',
    action: 'Verify that all required signers have approved the specific contract invocation.',
  },
};

/**
 * Decodes a Soroban invocation failure from an XDR result string.
 */
export function parseContractError(resultXdr: string): ContractErrorDetails {
  if (!resultXdr) {
    return {
      code: 'NO_XDR',
      message: 'No result XDR provided for parsing.',
      action: 'Check network logs for more details.',
    };
  }

  try {
    // 1. Attempt to parse as ScVal (standard for Soroban sim results)
    const scVal = xdr.ScVal.fromXDR(resultXdr, 'base64');

    // ScVal.switch() returns the enum value for the type
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    if ((scVal as any).switch().name === 'scvError') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      const scError = (scVal as any).error();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const type = String(scError.type().name);

      // Handle custom contract errors (ErrorTypeContract)
      if (type === 'errorTypeContract') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const value = String(scError.value());
        const mapping = ERROR_MAPPINGS[value];

        return {
          code: `ContractError(${value})`,
          message: mapping?.message || `Custom contract error code: ${value}`,
          action:
            mapping?.action || 'Refer to contract documentation for this specific error code.',
          rawXdr: resultXdr,
        };
      }

      // Handle standard host errors
      // The type name is usually something like 'errorTypeStorage', we want 'Storage'
      const typeName = type.replace('errorType', '');
      const mapping = ERROR_MAPPINGS[typeName];

      return {
        code: typeName,
        message: mapping?.message || `Host error: ${typeName}`,
        action: mapping?.action || 'An internal Stellar network error occurred during execution.',
        rawXdr: resultXdr,
      };
    }

    // 2. Fallback for non-error ScVal (shouldn't happen on failure)
    return {
      code: 'UNKNOWN_FORMAT',
      message: 'The transaction failed but the result XDR could not be parsed as a standard error.',
      action: 'Check the raw XDR for more details or contact support.',
      rawXdr: resultXdr,
    };
  } catch {
    // 3. Fallback for unparseable XDR
    return {
      code: 'UNPARSEABLE_XDR',
      message: 'Failed to decode the transaction result XDR.',
      action: 'The result may not be a valid Soroban error object.',
      rawXdr: resultXdr,
    };
  }
}
