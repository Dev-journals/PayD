import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  FileText,
  Calculator,
  Download,
  ChevronRight,
  ChevronLeft,
  Check,
  Search,
  MapPin,
  Building2,
} from 'lucide-react';
import {
  getAvailableCountries,
  COUNTRY_TAX_FIELDS,
  getTaxRules,
  calculateTaxPreview,
  validateTaxConfig,
  downloadTaxReportCSV,
  TaxRule,
  TaxPreview,
  TaxSummaryReport,
} from '../services/taxComplianceApi';

const COUNTRIES = getAvailableCountries();

const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸',
  India: '🇮🇳',
  'United Kingdom': '🇬🇧',
  Canada: '🇨🇦',
  Germany: '🇩🇪',
  Australia: '🇦🇺',
  France: '🇫🇷',
  Netherlands: '🇳🇱',
  Singapore: '🇸🇬',
  Japan: '🇯🇵',
};

interface TaxConfig {
  country: string;
  fields: Record<string, string>;
  warnings: string[];
}

const TaxComplianceWizard: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [config, setConfig] = useState<TaxConfig>({
    country: '',
    fields: {},
    warnings: [],
  });
  const [taxRules, setTaxRules] = useState<TaxRule[]>([]);
  const [taxPreviews, setTaxPreviews] = useState<TaxPreview[]>([]);
  const [grossPay, setGrossPay] = useState<string>('5000');
  const [employeeCount, setEmployeeCount] = useState<number>(10);
  const [reportData, setReportData] = useState<TaxSummaryReport | null>(null);
  const [startDate, setStartDate] = useState<string>(
    new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const loadTaxRules = async () => {
      setIsLoading(true);
      try {
        const rules = await getTaxRules();
        setTaxRules(rules);
      } catch (error) {
        console.error('Failed to load tax rules:', error);
      } finally {
        setIsLoading(false);
      }
    };
    void loadTaxRules();
  }, []);

  const filteredCountries = COUNTRIES.filter((country) =>
    country.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCountrySelect = (country: string) => {
    setConfig({
      ...config,
      country,
      fields: {},
      warnings: [],
    });
    setStep(2);
  };

  const handleFieldChange = (fieldLabel: string, value: string) => {
    setConfig({
      ...config,
      fields: {
        ...config.fields,
        [fieldLabel]: value,
      },
    });
  };

  const handleValidateConfig = () => {
    const warnings = validateTaxConfig(config.country, config.fields);
    setConfig({
      ...config,
      warnings,
    });
    if (warnings.length === 0) {
      setStep(3);
    }
  };

  const handleCalculatePreview = async () => {
    setIsLoading(true);
    try {
      const employeeIds = Array.from({ length: employeeCount }, (_, i) => String(i + 1));
      const previews = await calculateTaxPreview(
        employeeIds,
        parseFloat(grossPay) || 0,
        config.country
      );
      setTaxPreviews(previews);
      setStep(4);
    } catch (error) {
      console.error('Failed to calculate tax preview:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateReport = () => {
    const report: TaxSummaryReport = {
      organizationId: 1,
      country: config.country,
      period: { start: startDate, end: endDate },
      totalGrossPay: taxPreviews.reduce((sum, p) => sum + p.grossPay, 0),
      totalTaxCollected: taxPreviews.reduce((sum, p) => sum + p.taxAmount, 0),
      totalNetPay: taxPreviews.reduce((sum, p) => sum + p.netPay, 0),
      employeeCount: taxPreviews.length,
      details: taxPreviews.map((p) => ({
        employeeId: p.employeeId,
        employeeName: p.employeeName,
        grossPay: p.grossPay,
        taxAmount: p.taxAmount,
        netPay: p.netPay,
      })),
    };
    setReportData(report);
    setStep(5);
  };

  const handleExportCSV = () => {
    if (reportData) {
      downloadTaxReportCSV(reportData);
    }
  };

  const handleNext = () => setStep((s) => Math.min(s + 1, 5));
  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  const currentCountryFields = config.country ? COUNTRY_TAX_FIELDS[config.country] || [] : [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black mb-2">Tax Compliance Wizard</h1>
        <p className="text-muted">
          Configure tax rules and generate compliance reports for your organization
        </p>
      </div>

      <div className="card glass noise w-full p-6 sm:p-8 flex flex-col gap-6">
        <div className="flex justify-between items-center border-b border-hi pb-4">
          <h2 className="text-xl font-black">
            {step === 1 && 'Step 1: Select Country'}
            {step === 2 && 'Step 2: Tax Configuration'}
            {step === 3 && 'Step 3: Preview Calculator'}
            {step === 4 && 'Step 4: Generate Report'}
            {step === 5 && 'Step 5: Export Summary'}
          </h2>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`h-2 w-8 rounded-full transition-colors ${
                  step >= i ? 'bg-accent' : 'bg-surface'
                }`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="text"
                placeholder="Search countries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/20 border border-hi rounded-xl p-4 pl-12 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto">
              {filteredCountries.map((country) => (
                <button
                  key={country}
                  onClick={() => handleCountrySelect(country)}
                  className="flex items-center gap-3 p-4 rounded-xl border border-hi hover:border-accent/50 hover:bg-accent/5 transition-all text-left group"
                >
                  <span className="text-2xl">{COUNTRY_FLAGS[country] || '🌍'}</span>
                  <span className="font-medium text-sm">{country}</span>
                  <ChevronRight className="w-4 h-4 ml-auto text-muted group-hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>

            {filteredCountries.length === 0 && (
              <div className="text-center py-8 text-muted">
                <MapPin className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No countries found matching "{searchQuery}"</p>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-3 p-4 bg-surface rounded-xl">
              <span className="text-2xl">{COUNTRY_FLAGS[config.country] || '🌍'}</span>
              <div>
                <h3 className="font-bold">{config.country}</h3>
                <p className="text-sm text-muted">Tax compliance configuration</p>
              </div>
            </div>

            <div className="grid gap-4">
              {currentCountryFields.map((field) => (
                <div key={field.label}>
                  <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2 ml-1">
                    {field.label}
                    {field.required && <span className="text-danger ml-1">*</span>}
                  </label>
                  <input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={config.fields[field.label] || ''}
                    onChange={(e) => handleFieldChange(field.label, e.target.value)}
                    className="w-full bg-black/20 border border-hi rounded-xl p-4 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all font-mono"
                  />
                </div>
              ))}
            </div>

            {config.warnings.length > 0 && (
              <div className="flex flex-col gap-2">
                {config.warnings.map((warning) => (
                  <div
                    key={warning}
                    className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {warning}
                  </div>
                ))}
              </div>
            )}

            {taxRules.length > 0 && (
              <div className="mt-4 p-4 bg-surface/50 border border-hi rounded-xl">
                <h4 className="text-sm font-bold uppercase tracking-widest text-muted mb-3">
                  Active Tax Rules ({taxRules.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {taxRules.slice(0, 5).map((rule) => (
                    <span
                      key={rule.id}
                      className="px-3 py-1 bg-accent/10 text-accent text-xs rounded-full"
                    >
                      {rule.name} ({rule.value}
                      {rule.type === 'percentage' ? '%' : ''})
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 p-4 bg-accent/10 border border-accent/20 rounded-xl">
              <Building2 className="w-5 h-5 text-accent" />
              <span className="text-sm text-accent">
                Configure tax identifiers and rates for {config.country} compliance
              </span>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2 ml-1">
                  Default Gross Pay (per employee)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted">$</span>
                  <input
                    type="number"
                    value={grossPay}
                    onChange={(e) => setGrossPay(e.target.value)}
                    className="w-full bg-black/20 border border-hi rounded-xl p-4 pl-8 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2 ml-1">
                  Number of Employees
                </label>
                <input
                  type="number"
                  min="1"
                  value={employeeCount}
                  onChange={(e) => setEmployeeCount(parseInt(e.target.value) || 1)}
                  className="w-full bg-black/20 border border-hi rounded-xl p-4 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all font-mono"
                />
              </div>
            </div>

            <div className="bg-surface/50 border border-hi rounded-xl p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <Calculator className="w-5 h-5 text-accent" />
                Tax Preview Summary
              </h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-4 bg-black/20 rounded-xl">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Gross Pay</p>
                  <p className="text-xl font-bold font-mono">
                    ${(parseFloat(grossPay) || 0).toLocaleString()}
                  </p>
                </div>
                <div className="p-4 bg-black/20 rounded-xl">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Est. Tax</p>
                  <p className="text-xl font-bold font-mono text-danger">
                    ${((parseFloat(grossPay) || 0) * 0.25).toFixed(2)}
                  </p>
                </div>
                <div className="p-4 bg-black/20 rounded-xl">
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Net Pay</p>
                  <p className="text-xl font-bold font-mono text-success">
                    ${((parseFloat(grossPay) || 0) * 0.75).toFixed(2)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted mt-4 text-center">
                * Based on default 25% tax rate. Actual calculations will use configured rates.
              </p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2 ml-1">
                  Report Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-black/20 border border-hi rounded-xl p-4 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-muted mb-2 ml-1">
                  Report End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-black/20 border border-hi rounded-xl p-4 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all font-mono"
                />
              </div>
            </div>

            <div className="bg-surface/50 border border-hi rounded-xl p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-accent" />
                Report Preview
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface/50 text-xs uppercase text-muted tracking-wider border-b border-hi">
                    <tr>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Gross Pay</th>
                      <th className="px-4 py-3">Tax Amount</th>
                      <th className="px-4 py-3">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hi">
                    {taxPreviews.slice(0, 5).map((preview) => (
                      <tr key={preview.employeeId} className="bg-black/10">
                        <td className="px-4 py-3 font-medium">{preview.employeeName}</td>
                        <td className="px-4 py-3 font-mono">${preview.grossPay.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-danger">
                          ${preview.taxAmount.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 font-mono text-success">
                          ${preview.netPay.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {taxPreviews.length > 5 && (
                <p className="text-xs text-muted mt-2 text-center">
                  And {taxPreviews.length - 5} more employees...
                </p>
              )}
            </div>
          </div>
        )}

        {step === 5 && reportData && (
          <div className="flex flex-col gap-6">
            <div className="bg-success/10 border border-success/20 rounded-xl p-6 text-center">
              <Check className="w-12 h-12 mx-auto mb-2 text-success" />
              <h3 className="text-xl font-bold text-success mb-1">
                Report Generated Successfully!
              </h3>
              <p className="text-muted">
                Your tax compliance report for {config.country} is ready for export
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-surface/50 border border-hi rounded-xl p-4 text-center">
                <p className="text-xs text-muted uppercase tracking-wider">Total Employees</p>
                <p className="text-2xl font-bold">{reportData.employeeCount}</p>
              </div>
              <div className="bg-surface/50 border border-hi rounded-xl p-4 text-center">
                <p className="text-xs text-muted uppercase tracking-wider">Total Gross</p>
                <p className="text-2xl font-bold font-mono">
                  ${reportData.totalGrossPay.toLocaleString()}
                </p>
              </div>
              <div className="bg-surface/50 border border-hi rounded-xl p-4 text-center">
                <p className="text-xs text-muted uppercase tracking-wider">Tax Collected</p>
                <p className="text-2xl font-bold font-mono text-danger">
                  ${reportData.totalTaxCollected.toLocaleString()}
                </p>
              </div>
              <div className="bg-surface/50 border border-hi rounded-xl p-4 text-center">
                <p className="text-xs text-muted uppercase tracking-wider">Total Net</p>
                <p className="text-2xl font-bold font-mono text-success">
                  ${reportData.totalNetPay.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={handleExportCSV}
                className="flex items-center justify-center gap-2 py-4 px-6 rounded-xl bg-accent text-bg font-bold hover:brightness-110 transition-all"
              >
                <Download className="w-5 h-5" />
                Download CSV Report
              </button>
              <p className="text-xs text-muted text-center">
                Export as CSV for local government filing
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mt-4 border-t border-hi pt-6">
          <button
            className={`py-2 px-6 rounded-lg font-bold text-sm tracking-wide transition-colors ${
              step === 1
                ? 'text-muted hover:text-text cursor-pointer'
                : 'bg-surface hover:bg-hi/50 text-text'
            }`}
            onClick={step === 1 ? () => navigate('/') : handleBack}
          >
            {step === 1 ? (
              'Cancel'
            ) : (
              <span className="flex items-center gap-2">
                <ChevronLeft className="w-4 h-4" /> Back
              </span>
            )}
          </button>

          <div className="flex gap-2">
            {step === 2 && (
              <button
                className="py-2 px-6 rounded-lg bg-accent text-bg font-bold text-sm tracking-wide hover:brightness-110 shadow-lg shadow-accent/20 transition-all"
                onClick={handleValidateConfig}
              >
                Validate & Continue
              </button>
            )}
            {step === 3 && (
              <button
                className="py-2 px-6 rounded-lg bg-accent text-bg font-bold text-sm tracking-wide hover:brightness-110 shadow-lg shadow-accent/20 transition-all"
                onClick={() => {
                  void handleCalculatePreview();
                }}
                disabled={isLoading}
              >
                {isLoading ? 'Calculating...' : 'Calculate Preview'}
              </button>
            )}
            {step === 4 && (
              <button
                className="py-2 px-6 rounded-lg bg-accent text-bg font-bold text-sm tracking-wide hover:brightness-110 shadow-lg shadow-accent/20 transition-all"
                onClick={handleGenerateReport}
              >
                Generate Report
              </button>
            )}
            {step < 5 && step > 3 && (
              <button
                className="py-2 px-6 rounded-lg bg-accent text-bg font-bold text-sm tracking-wide hover:brightness-110 shadow-lg shadow-accent/20 transition-all"
                onClick={handleNext}
              >
                Continue <ChevronRight className="w-4 h-4 inline" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaxComplianceWizard;
