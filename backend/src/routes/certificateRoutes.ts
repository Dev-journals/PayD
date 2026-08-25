import { Router } from 'express';
import { PDFCertificateController } from '../controllers/pdfCertificateController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';

const router = Router();

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

/**
 * Generate PDF certificate for a payment transaction
 * GET /api/certificates/generate?employeeId=1&transactionHash=xxx&organizationId=1
 */
router.get('/generate', PDFCertificateController.generateCertificate);

/**
 * Verify a certificate by transaction hash
 * GET /api/certificates/verify?transactionHash=xxx&employeeId=1&organizationId=1
 */
router.get('/verify', PDFCertificateController.verifyCertificate);

/**
 * Get employee and organization info from transaction hash
 * GET /api/certificates/transaction-info?transactionHash=xxx
 */
router.get('/transaction-info', PDFCertificateController.getTransactionInfo);

export default router;
