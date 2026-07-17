import dotenv from 'dotenv';
import { createServer } from 'node:http';
import app from './app.js';
import logger from './utils/logger.js';
import config from './config/index.js';
import { initializeSocket } from './services/socketService.js';
import { scheduleExecutor } from './services/scheduleExecutor.js';
import { contractEventIndexer } from './services/contractEventIndexer.js';
import { liquidityAlertChecker } from './services/forecasting/liquidityAlertChecker.js';
import { scheduleDailyUsageSnapshots, scheduleNightlyIntegrityCheck } from './jobs/part49Jobs.js';
import { auditAnalyticsService } from './services/auditAnalyticsService.js';

dotenv.config();

const server = createServer(app);

// Initialize Socket.IO
initializeSocket(server);

const PORT = config.port || process.env.PORT || 4000;

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Contract registry: http://localhost:${PORT}/api/contracts`);

  // Initialize ScheduleExecutor after server starts
  scheduleExecutor.initialize();
  logger.info('ScheduleExecutor initialized');

  liquidityAlertChecker.initialize();
  logger.info('LiquidityAlertChecker initialized');

  // Initialize ContractEventIndexer
  contractEventIndexer.initialize();
  logger.info('ContractEventIndexer initialized');

  // Part 49 — daily quota snapshots + nightly audit-chain integrity
  scheduleDailyUsageSnapshots();
  scheduleNightlyIntegrityCheck();
  logger.info('Part-49 jobs scheduled (usage snapshots + audit integrity)');

  // Part 45 — cleanup expired audit cache every hour
  setInterval(async () => {
    try {
      const deleted = await auditAnalyticsService.cleanupExpiredCache();
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} expired audit cache entries`);
      }
    } catch (error) {
      logger.error('Failed to cleanup audit cache', { error });
    }
  }, 60 * 60 * 1000); // Every hour
  logger.info('Part-45 audit cache cleanup scheduled');
});

// Graceful shutdown handling
const shutdown = () => {
  logger.info('Shutting down gracefully...');

  // Stop the schedule executor
  scheduleExecutor.stop();

  liquidityAlertChecker.stop();

  // Stop the contract event indexer
  contractEventIndexer.stop();

  // Close the server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
