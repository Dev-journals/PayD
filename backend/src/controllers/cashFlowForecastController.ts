import { Request, Response } from 'express';
import { z } from 'zod';
import { CashFlowForecastService } from '../services/cashFlowForecastService.js';
import logger from '../utils/logger.js';
import { default as pool } from '../config/database.js';

const forecastQuerySchema = z.object({
  forecastDays: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 90))
    .refine((val) => val > 0 && val <= 365, {
      message: 'Forecast days must be between 1 and 365',
    }),
  distributionAccount: z.string().length(56, 'Distribution account must be 56 characters'),
  assetIssuer: z.string().length(56, 'Asset issuer must be 56 characters'),
});

export class CashFlowForecastController {
  /**
   * GET /api/cash-flow/forecast
   * Generate comprehensive cash flow forecast for an organization
   */
  static async getForecast(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req.user as { organizationId?: number })?.organizationId;

      if (!organizationId) {
        res.status(403).json({
          error: 'User is not associated with an organization',
        });
        return;
      }

      const validation = forecastQuerySchema.safeParse({
        forecastDays: req.query.forecastDays,
        distributionAccount: req.query.distributionAccount,
        assetIssuer: req.query.assetIssuer,
      });

      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request parameters',
          details: validation.error.errors,
        });
        return;
      }

      const { forecastDays, distributionAccount, assetIssuer } = validation.data;

      const forecast = await CashFlowForecastService.generateForecast(
        organizationId,
        distributionAccount,
        assetIssuer,
        forecastDays
      );

      res.json({
        success: true,
        data: forecast,
      });
    } catch (error) {
      logger.error('Failed to generate cash flow forecast', error);
      res.status(500).json({
        error: 'Failed to generate cash flow forecast',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/cash-flow/historical
   * Get historical payroll data analysis
   */
  static async getHistorical(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req.user as { organizationId?: number })?.organizationId;

      if (!organizationId) {
        res.status(403).json({
          error: 'User is not associated with an organization',
        });
        return;
      }

      const monthsBack = req.query.monthsBack
        ? parseInt(req.query.monthsBack as string, 10)
        : 6;

      if (monthsBack < 1 || monthsBack > 24) {
        res.status(400).json({
          error: 'Months back must be between 1 and 24',
        });
        return;
      }

      const historical = await CashFlowForecastService.analyzeHistoricalPayroll(
        organizationId,
        monthsBack
      );

      const averages = await CashFlowForecastService.calculateHistoricalAverages(organizationId);

      res.json({
        success: true,
        data: {
          historical,
          averages,
        },
      });
    } catch (error) {
      logger.error('Failed to get historical payroll data', error);
      res.status(500).json({
        error: 'Failed to get historical payroll data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/cash-flow/projections
   * Get upcoming scheduled payroll projections
   */
  static async getProjections(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req.user as { organizationId?: number })?.organizationId;

      if (!organizationId) {
        res.status(403).json({
          error: 'User is not associated with an organization',
        });
        return;
      }

      const forecastDays = req.query.forecastDays
        ? parseInt(req.query.forecastDays as string, 10)
        : 90;

      if (forecastDays < 1 || forecastDays > 365) {
        res.status(400).json({
          error: 'Forecast days must be between 1 and 365',
        });
        return;
      }

      const projections = await CashFlowForecastService.getUpcomingScheduledPayrolls(
        organizationId,
        forecastDays
      );

      res.json({
        success: true,
        data: projections,
      });
    } catch (error) {
      logger.error('Failed to get payroll projections', error);
      res.status(500).json({
        error: 'Failed to get payroll projections',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/cash-flow/alerts
   * Get budget alerts for the organization
   */
  static async getAlerts(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req.user as { organizationId?: number })?.organizationId;

      if (!organizationId) {
        res.status(403).json({
          error: 'User is not associated with an organization',
        });
        return;
      }

      const distributionAccount = req.query.distributionAccount as string;
      const assetIssuer = req.query.assetIssuer as string;

      if (!distributionAccount || distributionAccount.length !== 56) {
        res.status(400).json({
          error: 'Distribution account is required and must be 56 characters',
        });
        return;
      }

      if (!assetIssuer || assetIssuer.length !== 56) {
        res.status(400).json({
          error: 'Asset issuer is required and must be 56 characters',
        });
        return;
      }

      const forecastDays = req.query.forecastDays
        ? parseInt(req.query.forecastDays as string, 10)
        : 90;

      const forecast = await CashFlowForecastService.generateForecast(
        organizationId,
        distributionAccount,
        assetIssuer,
        forecastDays
      );

      res.json({
        success: true,
        data: {
          alerts: forecast.alerts,
          summary: {
            totalAlerts: forecast.alerts.length,
            criticalAlerts: forecast.alerts.filter((a) => a.severity === 'critical').length,
            warningAlerts: forecast.alerts.filter((a) => a.severity === 'warning').length,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to get budget alerts', error);
      res.status(500).json({
        error: 'Failed to get budget alerts',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
