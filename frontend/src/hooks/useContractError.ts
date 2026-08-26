import { useState, useCallback } from 'react';
import { parseContractError, ContractErrorDetails } from '../utils/contractErrorParser';

export function useContractError() {
  const [contractError, setContractError] = useState<ContractErrorDetails | null>(null);

  const handleContractError = useCallback(
    (resultXdr: string | undefined, fallbackMessage?: string) => {
      if (resultXdr) {
        const details = parseContractError(resultXdr);
        setContractError(details);
        return details;
      } else if (fallbackMessage) {
        setContractError({
          code: 'GENERIC_ERROR',
          message: fallbackMessage,
          action: 'Please check the transaction parameters and try again.',
        });
      }
      return null;
    },
    []
  );

  const clearContractError = useCallback(() => {
    setContractError(null);
  }, []);

  return {
    contractError,
    handleContractError,
    clearContractError,
  };
}
