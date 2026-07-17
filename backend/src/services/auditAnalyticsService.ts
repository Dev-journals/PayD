import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export interface AuditAnalyticsMetric {
  metricType: string;
  metricValue: number;
  dimension?: string;
  dimensionValue?: string;
  periodStart: Date;
  periodEnd: Date;
  metadata?: Record<string, any>;
}

export interface AuditSummary {
  totalRequests: number;
  errorRate: number;
  averageResponseTime: number;
  topEndpoints: Array<{ path: string; count: number; avgDuration: number }>;
  topErrors: Array<{ path: string; status: number; count: number }>;
  requestsByMethod: Record<string, number>;
  requestsByHour: Array<{ hour: number; count: number }>;
}

export interface AuditTrend {
  period: string;
  requestCount: number;
  errorCount: number;
  avgResponseTime: number;
}

/**
 * Service for audit analytics and reporting
 */
export class AuditAnalyticsService {
  /**
   * Record an analytics metric
   */
  async recordMetric(metric: AuditAnalyticsMetric): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO audit_analytics (
          organization_id, metric_type, metric_value, dimension,
          dimension_value, period_start, period_end, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
        [
          metric.metadata?.organizationId || null,
          metric.metricType,
          metric.metricValue,
          metric.dimension || null,
          metric.dimensionValue || null,
          metric.periodStart,
          metric.periodEnd,
          metric.metadata ? JSON.stringify(metric.metadata) : null,
        ]
      );
    } catch (error) {
      logger.error('Failed to record audit metric', { error, metricType: metric.metricType });
    }
  }

  /**
   * Get audit summary for an organization
   */
  async getAuditSummary(
    organizationId: number,
    startDate: Date,
    endDate: Date
  ): Promise<AuditSummary> {
    try {
      // Total requests and error rate
      const statsResult = await pool.query(
        `SELECT 
          COUNT(*) as total_requests,
          COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_count,
          AVG(duration_ms) as avg_response_time
         FROM api_audit_logs
         WHERE organization_id = $1
         AND created_at BETWEEN $2 AND $3`,
        [organizationId, startDate, endDate]
      );

      const stats = statsResult.rows[0];
      const totalRequests = parseInt(stats.total_requests, 10) || 0;
      const errorCount = parseInt(stats.error_count, 10) || 0;
      const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

      // Top endpoints
      const topEndpointsResult = await pool.query(
        `SELECT 
          path,
          COUNT(*) as count,
          AVG(duration_ms) as avg_duration
         FROM api_audit_logs
         WHERE organization_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY path
         ORDER BY count DESC
         LIMIT 10`,
        [organizationId, startDate, endDate]
      );

      // Top errors
      const topErrorsResult = await pool.query(
        `SELECT 
          path,
          response_status as status,
          COUNT(*) as count
         FROM api_audit_logs
         WHERE organization_id = $1
         AND created_at BETWEEN $2 AND $3
         AND response_status >= 400
         GROUP BY path, response_status
         ORDER BY count DESC
         LIMIT 10`,
        [organizationId, startDate, endDate]
      );

      // Requests by method
      const methodResult = await pool.query(
        `SELECT 
          method,
          COUNT(*) as count
         FROM api_audit_logs
         WHERE organization_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY method`,
        [organizationId, startDate, endDate]
      );

      // Requests by hour
      const hourlyResult = await pool.query(
        `SELECT 
          EXTRACT(HOUR FROM created_at) as hour,
          COUNT(*) as count
         FROM api_audit_logs
         WHERE organization_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY EXTRACT(HOUR FROM created_at)
         ORDER BY hour`,
        [organizationId, startDate, endDate]
      );

      const requestsByMethod: Record<string, number> = {};
      methodResult.rows.forEach((row) => {
        requestsByMethod[row.method] = parseInt(row.count, 10);
      });

      return {
        totalRequests,
        errorRate: Math.round(errorRate * 100) / 100,
        averageResponseTime: Math.round(stats.avg_response_time || 0),
        topEndpoints: topEndpointsResult.rows.map((row) => ({
          path: row.path,
          count: parseInt(row.count, 10),
          avgDuration: Math.round(row.avg_duration || 0),
        })),
        topErrors: topErrorsResult.rows.map((row) => ({
          path: row.path,
          status: row.status,
          count: parseInt(row.count, 10),
        })),
        requestsByMethod,
        requestsByHour: hourlyResult.rows.map((row) => ({
          hour: row.hour,
          count: parseInt(row.count, 10),
        })),
      };
    } catch (error) {
      logger.error('Failed to get audit summary', { error, organizationId });
      return {
        totalRequests: 0,
        errorRate: 0,
        averageResponseTime: 0,
        topEndpoints: [],
        topErrors: [],
        requestsByMethod: {},
        requestsByHour: [],
      };
    }
  }

  /**
   * Get audit trends over time
   */
  async getAuditTrends(
    organizationId: number,
    startDate: Date,
    endDate: Date,
    interval: 'hour' | 'day' | 'week' = 'day'
  ): Promise<AuditTrend[]> {
    try {
      let dateTrunc: string;
      switch (interval) {
        case 'hour':
          dateTrunc = 'hour';
          break;
        case 'week':
          dateTrunc = 'week';
          break;
        default:
          dateTrunc = 'day';
      }

      const result = await pool.query(
        `SELECT 
          DATE_TRUNC($4, created_at) as period,
          COUNT(*) as request_count,
          COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_count,
          AVG(duration_ms) as avg_response_time
         FROM api_audit_logs
         WHERE organization_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY DATE_TRUNC($4, created_at)
         ORDER BY period`,
        [organizationId, startDate, endDate, dateTrunc]
      );

      return result.rows.map((row) => ({
        period: row.period.toISOString(),
        requestCount: parseInt(row.request_count, 10),
        errorCount: parseInt(row.error_count, 10),
        avgResponseTime: Math.round(row.avg_response_time || 0),
      }));
    } catch (error) {
      logger.error('Failed to get audit trends', { error, organizationId });
      return [];
    }
  }

  /**
   * Get cached aggregation or compute if expired
   */
  async getCachedAggregation(
    organizationId: number,
    aggregationType: string,
    aggregationKey: string,
    computeFn: () => Promise<any>,
    ttlMinutes: number = 60
  ): Promise<any> {
    try {
      // Try to get from cache
      const cacheResult = await pool.query(
        `SELECT aggregation_value, expires_at
         FROM audit_log_aggregation_cache
         WHERE organization_id = $1
         AND aggregation_type = $2
         AND aggregation_key = $3`,
        [organizationId, aggregationType, aggregationKey]
      );

      if (cacheResult.rows.length > 0) {
        const cache = cacheResult.rows[0];
        if (new Date(cache.expires_at) > new Date()) {
          return JSON.parse(cache.aggregation_value);
        }
      }

      // Compute new value
      const value = await computeFn();
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      // Update cache
      await pool.query(
        `INSERT INTO audit_log_aggregation_cache (
          organization_id, aggregation_type, aggregation_key,
          aggregation_value, computed_at, expires_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
        ON CONFLICT (organization_id, aggregation_type, aggregation_key)
        DO UPDATE SET
          aggregation_value = EXCLUDED.aggregation_value,
          computed_at = CURRENT_TIMESTAMP,
          expires_at = EXCLUDED.expires_at`,
        [organizationId, aggregationType, aggregationKey, JSON.stringify(value), expiresAt]
      );

      return value;
    } catch (error) {
      logger.error('Failed to get cached aggregation', {
        error,
        organizationId,
        aggregationType,
      });
      return computeFn();
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache(): Promise<number> {
    try {
      const result = await pool.query(
        `DELETE FROM audit_log_aggregation_cache
         WHERE expires_at < CURRENT_TIMESTAMP`
      );
      return result.rowCount || 0;
    } catch (error) {
      logger.error('Failed to cleanup expired cache', { error });
      return 0;
    }
  }
}

export const auditAnalyticsService = new AuditAnalyticsService();