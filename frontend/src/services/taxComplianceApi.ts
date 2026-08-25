import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

function authHeaders() {
  const token = localStorage.getItem('payd_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export interface CountryTaxField {
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
}

export interface TaxRule {
  id?: number;
  organization_id?: number;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  description?: string;
  is_active: boolean;
  priority: number;
  country?: string;
}

export interface TaxPreview {
  employeeId: string;
  employeeName: string;
  grossPay: number;
  taxAmount: number;
  netPay: number;
  breakdown: {
    ruleName: string;
    amount: number;
  }[];
  warnings: string[];
}

export interface TaxSummaryReport {
  organizationId: number;
  country: string;
  period: {
    start: string;
    end: string;
  };
  totalGrossPay: number;
  totalTaxCollected: number;
  totalNetPay: number;
  employeeCount: number;
  details: {
    employeeId: string;
    employeeName: string;
    grossPay: number;
    taxAmount: number;
    netPay: number;
  }[];
}

export const COUNTRY_TAX_FIELDS: Record<string, CountryTaxField[]> = {
  'United States': [
    {
      label: 'Social Security Number (SSN)',
      type: 'text',
      required: true,
      placeholder: 'XXX-XX-XXXX',
    },
    { label: 'Federal Tax ID', type: 'text', required: true },
    { label: 'State Tax ID', type: 'text', required: false },
    { label: 'Federal Withholding Rate (%)', type: 'number', required: true },
    { label: 'State Withholding Rate (%)', type: 'number', required: false },
  ],
  India: [
    {
      label: 'Permanent Account Number (PAN)',
      type: 'text',
      required: true,
      placeholder: 'ABCDE1234F',
    },
    { label: 'Tax Deduction Account Number (TAN)', type: 'text', required: true },
    { label: 'GST Number', type: 'text', required: false },
    { label: 'Income Tax Rate (%)', type: 'number', required: true },
    { label: 'Professional Tax (%)', type: 'number', required: false },
  ],
  'United Kingdom': [
    {
      label: 'National Insurance Number',
      type: 'text',
      required: true,
      placeholder: 'AB 12 34 56 C',
    },
    { label: 'PAYE Reference', type: 'text', required: true },
    { label: 'UTR (Unique Taxpayer Reference)', type: 'text', required: false },
    { label: 'Income Tax Rate (%)', type: 'number', required: true },
    { label: 'National Insurance Rate (%)', type: 'number', required: true },
  ],
  Canada: [
    {
      label: 'Social Insurance Number (SIN)',
      type: 'text',
      required: true,
      placeholder: 'XXX-XXX-XXX',
    },
    { label: 'Business Number', type: 'text', required: true },
    { label: 'Federal Tax Rate (%)', type: 'number', required: true },
    { label: 'Provincial Tax Rate (%)', type: 'number', required: true },
  ],
  Germany: [
    { label: 'Tax Identification Number (Steuer-ID)', type: 'text', required: true },
    { label: 'VAT Number (USt-IdNr.)', type: 'text', required: false },
    { label: 'Income Tax Rate (%)', type: 'number', required: true },
    { label: 'Church Tax Rate (%)', type: 'number', required: false },
  ],
  Australia: [
    { label: 'Tax File Number (TFN)', type: 'text', required: true },
    { label: 'Australian Business Number (ABN)', type: 'text', required: true },
    { label: 'Income Tax Rate (%)', type: 'number', required: true },
    { label: 'Medicare Levy (%)', type: 'number', required: false },
  ],
  France: [
    { label: 'Numéro Fiscal de Référence', type: 'text', required: true },
    { label: 'Numéro SIRET', type: 'text', required: false },
    { label: 'Income Tax Rate (%)', type: 'number', required: true },
    { label: 'CSG Rate (%)', type: 'number', required: true },
  ],
  Netherlands: [
    { label: 'BSN (Burgerservicenummer)', type: 'text', required: true },
    { label: 'Loonheffing Number', type: 'text', required: false },
    { label: 'Income Tax Rate (%)', type: 'number', required: true },
  ],
  Singapore: [
    { label: 'NRIC/FIN', type: 'text', required: true },
    { label: 'Tax Reference Number', type: 'text', required: true },
    { label: 'Income Tax Rate (%)', type: 'number', required: true },
  ],
  Japan: [
    { label: 'My Number', type: 'text', required: true },
    { label: 'Tax Office Code', type: 'text', required: false },
    { label: 'Income Tax Rate (%)', type: 'number', required: true },
  ],
};

export const getAvailableCountries = (): string[] => {
  return Object.keys(COUNTRY_TAX_FIELDS).sort();
};

export const getTaxRules = async (): Promise<TaxRule[]> => {
  try {
    const { data } = await axios.get<{ success: boolean; data: TaxRule[] }>(
      `${API_BASE_URL}/taxes/rules`,
      { headers: authHeaders() }
    );
    return data.data || [];
  } catch (error) {
    console.error('Error fetching tax rules:', error);
    return [];
  }
};

export const createTaxRule = async (rule: TaxRule): Promise<TaxRule> => {
  const { data } = await axios.post<{ success: boolean; data: TaxRule }>(
    `${API_BASE_URL}/taxes/rules`,
    rule,
    { headers: authHeaders() }
  );
  return data.data;
};

export const updateTaxRule = async (id: number, rule: Partial<TaxRule>): Promise<TaxRule> => {
  const { data } = await axios.put<{ success: boolean; data: TaxRule }>(
    `${API_BASE_URL}/taxes/rules/${id}`,
    rule,
    { headers: authHeaders() }
  );
  return data.data;
};

export const deleteTaxRule = async (id: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/taxes/rules/${id}`, {
    headers: authHeaders(),
  });
};

export const calculateTaxPreview = async (
  employeeIds: string[],
  grossPay: number,
  country: string
): Promise<TaxPreview[]> => {
  try {
    const rules = await getTaxRules();
    const countryRules = rules.filter((r) => r.is_active && (!r.country || r.country === country));

    return employeeIds.map((id) => {
      let totalTax = 0;
      const breakdown = countryRules.map((rule) => {
        const amount = rule.type === 'percentage' ? (grossPay * rule.value) / 100 : rule.value;
        totalTax += amount;
        return {
          ruleName: rule.name,
          amount,
        };
      });

      return {
        employeeId: id,
        employeeName: `Employee ${id}`,
        grossPay,
        taxAmount: totalTax,
        netPay: grossPay - totalTax,
        breakdown,
        warnings: [],
      };
    });
  } catch (error) {
    console.error('Error calculating tax preview:', error);
    return [];
  }
};

export const validateTaxConfig = (country: string, config: Record<string, string>): string[] => {
  const warnings: string[] = [];
  const fields = COUNTRY_TAX_FIELDS[country];

  if (!fields) {
    warnings.push(`Country "${country}" tax configuration not found`);
    return warnings;
  }

  fields.forEach((field) => {
    if (field.required && !config[field.label]) {
      warnings.push(`Missing required field: ${field.label}`);
    }
  });

  return warnings;
};

export const exportTaxSummary = async (
  country: string,
  startDate: string,
  endDate: string
): Promise<TaxSummaryReport> => {
  try {
    const { data } = await axios.get<{ success: boolean; data: TaxSummaryReport }>(
      `${API_BASE_URL}/taxes/reports`,
      {
        params: { country, startDate, endDate },
        headers: authHeaders(),
      }
    );
    return data.data;
  } catch (error) {
    console.error('Error exporting tax summary:', error);
    throw error;
  }
};

export const downloadTaxReportCSV = (report: TaxSummaryReport): void => {
  const headers = ['Employee ID', 'Employee Name', 'Gross Pay', 'Tax Amount', 'Net Pay'];
  const rows = report.details.map((detail) => [
    detail.employeeId,
    detail.employeeName,
    detail.grossPay.toFixed(2),
    detail.taxAmount.toFixed(2),
    detail.netPay.toFixed(2),
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
    '',
    `Total Gross Pay,${report.totalGrossPay.toFixed(2)}`,
    `Total Tax Collected,${report.totalTaxCollected.toFixed(2)}`,
    `Total Net Pay,${report.totalNetPay.toFixed(2)}`,
    `Employee Count,${report.employeeCount}`,
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tax-summary-${report.country}-${report.period.start}-to-${report.period.end}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};
