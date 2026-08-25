import axios, { type AxiosError } from 'axios';

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:3001';

export interface HistoricalPayrollData {
  period: string;
  totalAmount: number;
  baseAmount: number;
  bonusAmount: number;
  runCount: number;
  averageAmount: number;
}

export interface UpcomingPayrollProjection {
  date: string;
  projectedAmount: number;
  scheduleId: number;
  frequency: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface CashFlowForecast {
  organizationId: number;
  currentBalance: string;
  forecastPeriod: {
    start: string;
    end: string;
  };
  historicalAverage: {
    weekly: number;
    biweekly: number;
    monthly: number;
  };
  projections: UpcomingPayrollProjection[];
  totalProjectedOutflow: number;
  projectedBalance: number;
  alerts: BudgetAlert[];
  trendAnalysis: {
    direction: 'increasing' | 'decreasing' | 'stable';
    changePercent: number;
    periodCount: number;
  };
}

export interface BudgetAlert {
  type: 'insufficient_funds' | 'approaching_limit' | 'unusual_spike' | 'schedule_conflict';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  projectedDate: string;
  projectedAmount: number;
  currentBalance: string;
  shortfall?: number;
}

export interface ForecastParams {
  forecastDays?: number;
  distributionAccount: string;
  assetIssuer: string;
}

export interface HistoricalDataResponse {
  success: boolean;
  data: {
    historical: HistoricalPayrollData[];
    averages: {
      weekly: number;
      biweekly: number;
      monthly: number;
    };
  };
}

export interface ForecastResponse {
  success: boolean;
  data: CashFlowForecast;
}

export interface ProjectionsResponse {
  success: boolean;
  data: UpcomingPayrollProjection[];
}

export interface AlertsResponse {
  success: boolean;
  data: {
    alerts: BudgetAlert[];
    summary: {
      totalAlerts: number;
      criticalAlerts: number;
      warningAlerts: number;
    };
  };
}

/**
 * Get comprehensive cash flow forecast
 */
export const getForecast = async (params: ForecastParams): Promise<CashFlowForecast> => {
  try {
    const response = await axios.get<ForecastResponse>(`${API_BASE_URL}/api/cash-flow/forecast`, {
      params: {
        forecastDays: params.forecastDays || 90,
        distributionAccount: params.distributionAccount,
        assetIssuer: params.assetIssuer,
      },
      headers: {
        Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
      },
    });

    if (!response.data.success) {
      throw new Error('Failed to fetch forecast');
    }

    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string }>;
      const errorMessage =
        (axiosError.response?.data as { message?: string } | undefined)?.message ||
        axiosError.message ||
        'Failed to fetch cash flow forecast';
      const newError = new Error(errorMessage);
      Object.assign(newError, { cause: error });
      throw newError;
    }
    throw error;
  }
};

/**
 * Get historical payroll data analysis
 */
export const getHistoricalData = async (
  monthsBack?: number
): Promise<{
  historical: HistoricalPayrollData[];
  averages: { weekly: number; biweekly: number; monthly: number };
}> => {
  try {
    const response = await axios.get<HistoricalDataResponse>(
      `${API_BASE_URL}/api/cash-flow/historical`,
      {
        params: {
          monthsBack: monthsBack || 6,
        },
        headers: {
          Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
        },
      }
    );

    if (!response.data.success) {
      throw new Error('Failed to fetch historical data');
    }

    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string }>;
      const errorMessage =
        (axiosError.response?.data as { message?: string } | undefined)?.message ||
        axiosError.message ||
        'Failed to fetch historical payroll data';
      const newError = new Error(errorMessage);
      Object.assign(newError, { cause: error });
      throw newError;
    }
    throw error;
  }
};

/**
 * Get upcoming scheduled payroll projections
 */
export const getProjections = async (
  forecastDays?: number
): Promise<UpcomingPayrollProjection[]> => {
  try {
    const response = await axios.get<ProjectionsResponse>(
      `${API_BASE_URL}/api/cash-flow/projections`,
      {
        params: {
          forecastDays: forecastDays || 90,
        },
        headers: {
          Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
        },
      }
    );

    if (!response.data.success) {
      throw new Error('Failed to fetch projections');
    }

    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string }>;
      const errorMessage =
        (axiosError.response?.data as { message?: string } | undefined)?.message ||
        axiosError.message ||
        'Failed to fetch payroll projections';
      const newError = new Error(errorMessage);
      Object.assign(newError, { cause: error });
      throw newError;
    }
    throw error;
  }
};

/**
 * Get budget alerts
 */
export const getAlerts = async (
  params: ForecastParams
): Promise<{
  alerts: BudgetAlert[];
  summary: { totalAlerts: number; criticalAlerts: number; warningAlerts: number };
}> => {
  try {
    const response = await axios.get<AlertsResponse>(`${API_BASE_URL}/api/cash-flow/alerts`, {
      params: {
        forecastDays: params.forecastDays || 90,
        distributionAccount: params.distributionAccount,
        assetIssuer: params.assetIssuer,
      },
      headers: {
        Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
      },
    });

    if (!response.data.success) {
      throw new Error('Failed to fetch alerts');
    }

    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string }>;
      const errorMessage =
        (axiosError.response?.data as { message?: string } | undefined)?.message ||
        axiosError.message ||
        'Failed to fetch budget alerts';
      const newError = new Error(errorMessage);
      Object.assign(newError, { cause: error });
      throw newError;
    }
    throw error;
  }
};
