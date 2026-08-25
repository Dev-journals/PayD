import { default as pool } from '../config/database.js';
import { BalanceService } from './balanceService.js';
import logger from '../utils/logger.js';

export interface HistoricalPayrollData {
  period: string;
  totalAmount: number;
  baseAmount: number;
  bonusAmount: number;
  runCount: number;
  averageAmount: number;
}

export interface UpcomingPayrollProjection {
  date: Date;
  projectedAmount: number;
  scheduleId: number;
  frequency: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface CashFlowForecast {
  organizationId: number;
  currentBalance: string;
  forecastPeriod: {
    start: Date;
    end: Date;
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
  projectedDate: Date;
  projectedAmount: number;
  currentBalance: string;
  shortfall?: number;
}

export class CashFlowForecastService {
  /**
   * Analyze historical payroll data to calculate averages by frequency
   */
  static async analyzeHistoricalPayroll(
    organizationId: number,
    monthsBack: number = 6
  ): Promise<HistoricalPayrollData[]> {
    const client = await pool.connect();
    try {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);

      const query = `
        SELECT 
          DATE_TRUNC('month', period_start) as period,
          COUNT(*) as run_count,
          SUM(total_amount) as total_amount,
          SUM(total_base_amount) as base_amount,
          SUM(total_bonus_amount) as bonus_amount,
          AVG(total_amount) as avg_amount
        FROM payroll_runs
        WHERE organization_id = $1
          AND status = 'completed'
          AND period_start >= $2
        GROUP BY DATE_TRUNC('month', period_start)
        ORDER BY period DESC
      `;

      const result = await client.query(query, [organizationId, cutoffDate]);

      return result.rows.map((row) => ({
        period: row.period.toISOString().split('T')[0],
        totalAmount: parseFloat(row.total_amount || '0'),
        baseAmount: parseFloat(row.base_amount || '0'),
        bonusAmount: parseFloat(row.bonus_amount || '0'),
        runCount: parseInt(row.run_count, 10),
        averageAmount: parseFloat(row.avg_amount || '0'),
      }));
    } catch (error) {
      logger.error('Failed to analyze historical payroll', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get upcoming scheduled payrolls with projected amounts
   */
  static async getUpcomingScheduledPayrolls(
    organizationId: number,
    forecastDays: number = 90
  ): Promise<UpcomingPayrollProjection[]> {
    const client = await pool.connect();
    try {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + forecastDays);

      const query = `
        SELECT 
          s.id,
          s.frequency,
          s.next_run_timestamp,
          s.payment_config,
          s.status
        FROM schedules s
        WHERE s.organization_id = $1
          AND s.status = 'active'
          AND s.next_run_timestamp <= $2
        ORDER BY s.next_run_timestamp ASC
      `;

      const result = await client.query(query, [organizationId, endDate]);

      const projections: UpcomingPayrollProjection[] = [];

      for (const row of result.rows) {
        const paymentConfig = row.payment_config as {
          recipients?: Array<{ amount: string; assetCode?: string }>;
        };

        let projectedAmount = 0;
        if (paymentConfig?.recipients) {
          projectedAmount = paymentConfig.recipients.reduce((sum, recipient) => {
            return sum + parseFloat(recipient.amount || '0');
          }, 0);
        }

        projections.push({
          date: new Date(row.next_run_timestamp),
          projectedAmount,
          scheduleId: row.id,
          frequency: row.frequency,
          confidence: this.calculateConfidence(row.frequency, row.next_run_timestamp),
        });
      }

      return projections;
    } catch (error) {
      logger.error('Failed to get upcoming scheduled payrolls', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Calculate confidence level for a projection based on schedule history
   */
  private static calculateConfidence(
    frequency: string,
    nextRun: Date
  ): 'high' | 'medium' | 'low' {
    const daysUntil = Math.floor(
      (nextRun.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );

    if (frequency === 'once') {
      return daysUntil <= 7 ? 'high' : daysUntil <= 30 ? 'medium' : 'low';
    }

    if (daysUntil <= 7) return 'high';
    if (daysUntil <= 30) return 'medium';
    return 'low';
  }

  /**
   * Calculate historical averages by frequency
   */
  static async calculateHistoricalAverages(
    organizationId: number
  ): Promise<{ weekly: number; biweekly: number; monthly: number }> {
    const historical = await this.analyzeHistoricalPayroll(organizationId, 6);

    if (historical.length === 0) {
      return { weekly: 0, biweekly: 0, monthly: 0 };
    }

    const monthlyTotal = historical.reduce((sum, h) => sum + h.totalAmount, 0);
    const monthlyAverage = monthlyTotal / historical.length;

    return {
      weekly: monthlyAverage / 4.33,
      biweekly: monthlyAverage / 2.17,
      monthly: monthlyAverage,
    };
  }

  /**
   * Generate comprehensive cash flow forecast
   */
  static async generateForecast(
    organizationId: number,
    distributionAccount: string,
    assetIssuer: string,
    forecastDays: number = 90
  ): Promise<CashFlowForecast> {
    try {
      const [currentBalance, historical, projections, averages] = await Promise.all([
        BalanceService.getOrgUsdBalance(distributionAccount, assetIssuer),
        this.analyzeHistoricalPayroll(organizationId, 6),
        this.getUpcomingScheduledPayrolls(organizationId, forecastDays),
        this.calculateHistoricalAverages(organizationId),
      ]);

      const balance = parseFloat(currentBalance.balance || '0');
      const totalProjected = projections.reduce((sum, p) => sum + p.projectedAmount, 0);
      const projectedBalance = balance - totalProjected;

      const trendAnalysis = this.analyzeTrend(historical);

      const alerts = this.generateBudgetAlerts(
        balance,
        projections,
        averages,
        distributionAccount
      );

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + forecastDays);

      return {
        organizationId,
        currentBalance: currentBalance.balance || '0',
        forecastPeriod: {
          start: new Date(),
          end: endDate,
        },
        historicalAverage: averages,
        projections,
        totalProjectedOutflow: totalProjected,
        projectedBalance,
        alerts,
        trendAnalysis,
      };
    } catch (error) {
      logger.error('Failed to generate cash flow forecast', error);
      throw error;
    }
  }

  /**
   * Analyze trend direction from historical data
   */
  private static analyzeTrend(historical: HistoricalPayrollData[]): {
    direction: 'increasing' | 'decreasing' | 'stable';
    changePercent: number;
    periodCount: number;
  } {
    if (historical.length < 2) {
      return {
        direction: 'stable',
        changePercent: 0,
        periodCount: historical.length,
      };
    }

    const sorted = [...historical].sort((a, b) => a.period.localeCompare(b.period));
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

    const firstAvg =
      firstHalf.reduce((sum, h) => sum + h.totalAmount, 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((sum, h) => sum + h.totalAmount, 0) / secondHalf.length;

    const changePercent = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;

    let direction: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(changePercent) < 5) {
      direction = 'stable';
    } else if (changePercent > 0) {
      direction = 'increasing';
    } else {
      direction = 'decreasing';
    }

    return {
      direction,
      changePercent: Math.round(changePercent * 100) / 100,
      periodCount: historical.length,
    };
  }

  /**
   * Generate budget alerts based on projections and current balance
   */
  private static generateBudgetAlerts(
    currentBalance: number,
    projections: UpcomingPayrollProjection[],
    averages: { weekly: number; biweekly: number; monthly: number },
    distributionAccount: string
  ): BudgetAlert[] {
    const alerts: BudgetAlert[] = [];

    let runningBalance = currentBalance;

    for (const projection of projections) {
      runningBalance -= projection.projectedAmount;

      if (runningBalance < 0) {
        alerts.push({
          type: 'insufficient_funds',
          severity: 'critical',
          message: `Insufficient funds projected for scheduled payroll on ${projection.date.toLocaleDateString()}. Shortfall: ${Math.abs(runningBalance).toFixed(2)}`,
          projectedDate: projection.date,
          projectedAmount: projection.projectedAmount,
          currentBalance: currentBalance.toFixed(2),
          shortfall: Math.abs(runningBalance),
        });
      } else if (runningBalance < projection.projectedAmount * 1.5) {
        alerts.push({
          type: 'approaching_limit',
          severity: 'warning',
          message: `Balance will be low after payroll on ${projection.date.toLocaleDateString()}. Consider adding funds.`,
          projectedDate: projection.date,
          projectedAmount: projection.projectedAmount,
          currentBalance: runningBalance.toFixed(2),
        });
      }

      runningBalance = Math.max(0, runningBalance);
    }

    const totalProjected = projections.reduce((sum, p) => sum + p.projectedAmount, 0);
    if (totalProjected > currentBalance) {
      alerts.push({
        type: 'insufficient_funds',
        severity: 'critical',
        message: `Total projected payroll (${totalProjected.toFixed(2)}) exceeds current balance (${currentBalance.toFixed(2)})`,
        projectedDate: projections[0]?.date || new Date(),
        projectedAmount: totalProjected,
        currentBalance: currentBalance.toFixed(2),
        shortfall: totalProjected - currentBalance,
      });
    }

    const monthlyProjected = projections
      .filter((p) => {
        const daysDiff = Math.floor(
          (p.date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysDiff <= 30;
      })
      .reduce((sum, p) => sum + p.projectedAmount, 0);

    if (monthlyProjected > averages.monthly * 1.2) {
      alerts.push({
        type: 'unusual_spike',
        severity: 'warning',
        message: `Projected monthly payroll (${monthlyProjected.toFixed(2)}) is 20% higher than historical average (${averages.monthly.toFixed(2)})`,
        projectedDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        projectedAmount: monthlyProjected,
        currentBalance: currentBalance.toFixed(2),
      });
    }

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }
}
