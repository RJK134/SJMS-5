import type { Request, Response, NextFunction } from 'express';
import * as service from './ledger-anomalies.service';

/**
 * POST /v1/ledger-anomalies/scan (Phase 1E).
 *
 * Runs the read-only ledger anomaly scan and returns the structured
 * report. FINANCE-role gated.
 */
export async function scan(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.scanLedgerAnomalies(
      req.body as service.ScanOptions,
      req.user?.sub ?? 'system',
      req,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
