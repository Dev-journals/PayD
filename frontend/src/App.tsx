import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Home from './pages/Home';
import Debugger from './pages/Debugger';
import PayrollScheduler from './pages/PayrollScheduler';
import EmployeeEntry from './pages/EmployeeEntry';
import EmployerLayout from './components/EmployerLayout';
import HelpCenter from './pages/HelpCenter';
import ErrorBoundary from './components/ErrorBoundary';
import ErrorFallback from './components/ErrorFallback';
import Settings from './pages/Settings';
import WebhookSettings from './pages/WebhookSettings';
import TwoFactorSettings from './pages/TwoFactorSettings';
import CustomReportBuilder from './pages/CustomReportBuilder';
import CrossAssetPayment from './pages/CrossAssetPayment';
import TransactionHistory from './pages/TransactionHistory';
import AdminPanel from './pages/AdminPanel';
import VestingEscrow from './pages/VestingEscrow';
import RevenueSplitDashboard from './pages/RevenueSplitDashboard';
import Forecasting from './pages/Forecasting';
import TaxComplianceWizard from './pages/TaxComplianceWizard';

import EmployeePortal from './pages/EmployeePortal';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import { useTranslation } from 'react-i18next';
import { contractService } from './services/contracts';

function App() {
  const { t } = useTranslation();

  // Initialize contract service on app startup
  useEffect(() => {
    contractService.initialize().catch((error) => {
      console.error('Failed to initialize contract service:', error);
    });
  }, []);

  return (
    <Routes>
      <Route element={<EmployerLayout />}>
        <Route
          path="/"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.homeTitle')}
                  description={t('errorFallback.homeDescription')}
                />
              }
            >
              <Home />
            </ErrorBoundary>
          }
        />
        <Route
          path="/payroll"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.payrollTitle')}
                  description={t('errorFallback.payrollDescription')}
                />
              }
            >
              <PayrollScheduler />
            </ErrorBoundary>
          }
        />
        <Route
          path="/employee"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.employeesTitle')}
                  description={t('errorFallback.employeesDescription')}
                />
              }
            >
              <EmployeeEntry />
            </ErrorBoundary>
          }
        />
        <Route
          path="/portal"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title="Employee Portal Error"
                  description="Something went wrong loading your portal."
                />
              }
            >
              <EmployeePortal />
            </ErrorBoundary>
          }
        />
        <Route
          path="/reports"
          element={
            <ErrorBoundary fallback={<ErrorFallback />}>
              <CustomReportBuilder />
            </ErrorBoundary>
          }
        />
        <Route
          path="/debug"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.debuggerTitle')}
                  description={t('errorFallback.debuggerDescription')}
                />
              }
            >
              <Debugger />
            </ErrorBoundary>
          }
        />
        <Route
          path="/debug/:contractName"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.debuggerTitle')}
                  description={t('errorFallback.debuggerDescription')}
                />
              }
            >
              <Debugger />
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin"
          element={
            <ErrorBoundary fallback={<ErrorFallback />}>
              <AdminPanel />
            </ErrorBoundary>
          }
        />
        <Route
          path="/settings"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <Settings />
            </ErrorBoundary>
          }
        />
        <Route
          path="/settings/webhooks"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <WebhookSettings />
            </ErrorBoundary>
          }
        />
        <Route
          path="/settings/two-factor"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <TwoFactorSettings />
            </ErrorBoundary>
          }
        />
        <Route
          path="/help"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <HelpCenter />
            </ErrorBoundary>
          }
        />
        <Route
          path="/cross-asset-payment"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <CrossAssetPayment />
            </ErrorBoundary>
          }
        />
        <Route
          path="/transactions"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <TransactionHistory />
            </ErrorBoundary>
          }
        />
        <Route
          path="/forecast"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <Forecasting />
            </ErrorBoundary>
          }
        />
        <Route
          path="/vesting"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <VestingEscrow />
            </ErrorBoundary>
          }
        />
        <Route
          path="/revenue-split"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <RevenueSplitDashboard />
            </ErrorBoundary>
          }
        />
        <Route
          path="/tax-compliance"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <TaxComplianceWizard />
            </ErrorBoundary>
          }
        />
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="/auth-callback" element={<AuthCallback />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
