import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

function authHeaders() {
  const token = localStorage.getItem('payd_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export interface DraftPayslipLine {
  source: 'deduction_rule' | 'tax_rule';
  source_id: number;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  amount: number;
  destination_wallet_address: string | null;
  destination_kind: 'treasury' | 'provider';
}

export interface DraftPayslip {
  organization_id: number;
  employee_id: number;
  currency: string;
  gross_amount: number;
  lines: DraftPayslipLine[];
  total_deductions: number;
  net_amount: number;
}

export const getMyDeductionsDraftPayslip = async (): Promise<DraftPayslip> => {
  const { data } = await axios.get<{ success: boolean; data: DraftPayslip }>(
    `${API_BASE_URL}/benefits/me/deductions`,
    {
      headers: authHeaders(),
    }
  );

  return data.data;
};
