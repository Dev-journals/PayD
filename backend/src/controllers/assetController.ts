import { Request, Response } from 'express';
import { AssetService } from '../services/assetService.js';
import { Keypair } from '@stellar/stellar-sdk';
import { pool } from '../config/database.js';

export class AssetController {
  /**
   * POST /api/assets/orgusd/issue
   * Issues ORGUSD asset with auth_clawback_enabled flag.
   */
  static async issueOrgUsd(req: Request, res: Response) {
    const { issuerSecret, distributorSecret, amount } = req.body;

    if (!issuerSecret || !distributorSecret || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const issuerKeypair = Keypair.fromSecret(issuerSecret);
      const distributorKeypair = Keypair.fromSecret(distributorSecret);

      const asset = await AssetService.issueOrgUsdAsset(issuerKeypair, distributorKeypair, amount);

      res.json({
        success: true,
        asset: {
          code: asset.code,
          issuer: asset.issuer,
        },
      });
    } catch (error: any) {
      console.error('Issue ORGUSD Error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/assets/orgusd/clawback
   * Executes a clawback operation.
   */
  static async clawback(req: Request, res: Response) {
    const { issuerSecret, fromAccount, amount, reason } = req.body;

    if (!issuerSecret || !fromAccount || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const issuerKeypair = Keypair.fromSecret(issuerSecret);

      const txHash = await AssetService.clawbackAsset(issuerKeypair, fromAccount, amount, reason);

      res.json({
        success: true,
        txHash,
        message: `Successfully clawed back ${amount} ORGUSD from ${fromAccount}`,
      });
    } catch (error: any) {
      console.error('Clawback Error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/assets/clawback/logs
   * Returns a paginated list of clawback audit log entries.
   * Optional query: fromAccount, page, limit
   */
  static async getClawbackLogs(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const fromAccount = (req.query.fromAccount as string) || null;

    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (fromAccount) {
        params.push(fromAccount);
        conditions.push(`from_account = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Total count
      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM clawback_audit_logs ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Paginated rows
      const dataParams = [...params, limit, offset];
      const dataResult = await pool.query(
        `SELECT id, transaction_hash, asset_code, amount, from_account, issuer_account, reason, created_at
         FROM clawback_audit_logs
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      );

      res.json({
        success: true,
        data: dataResult.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error: any) {
      console.error('Get Clawback Logs Error:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
