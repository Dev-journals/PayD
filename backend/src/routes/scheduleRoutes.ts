import { Router } from 'express';
import { ScheduleController } from '../controllers/scheduleController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { authorizeRoles, isolateOrganization } from '../middlewares/rbac.js';
import { idempotencyMiddleware } from '../middleware/idempotencyMiddleware.js';

const router = Router();

// Apply authentication to all schedule routes
router.use(authenticateJWT);
router.use(isolateOrganization);

/**
 * @route POST /api/schedules
 * @desc Create a new payroll schedule
 * @access Private - Requires authentication
 * @body {CreateScheduleRequest} Schedule configuration
 * @returns {CreateScheduleResponse} Created schedule with ID and next run timestamp
 */
router.post(
  '/',
  authorizeRoles('EMPLOYER'),
  idempotencyMiddleware(),
  ScheduleController.createSchedule
);

/**
 * @route GET /api/schedules
 * @desc Get all schedules for the authenticated user's organization
 * @access Private - Requires authentication
 * @query {string} status - Optional filter by status (active, completed, cancelled)
 * @query {number} page - Optional page number for pagination
 * @query {number} limit - Optional items per page
 * @returns {GetSchedulesResponse} List of schedules with pagination metadata
 */
router.get(
  '/',
  authorizeRoles('EMPLOYER'),
  ScheduleController.getSchedules
);

/**
 * @route DELETE /api/schedules/:id
 * @desc Cancel a pending schedule
 * @access Private - Requires authentication and schedule ownership
 * @param {number} id - Schedule ID
 * @returns {204} No content on success
 * @returns {404} Schedule not found
 * @returns {403} User doesn't own this schedule
 */
router.delete(
  '/:id',
  authorizeRoles('EMPLOYER'),
  ScheduleController.deleteSchedule
);

export default router;
