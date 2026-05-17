/**
 * finance-student generator
 *
 * D1: empty CSVs for all 16 finance-student-domain models.
 * D9: ~80,000 Fee rows (one per student × academic year × feeType),
 *     ~80,000 Invoices, ~200,000 Payments + PaymentTransactions across
 *     instalment plans / SLC / sponsor / self-pay channels,
 *     SponsorRecord + SponsorPayment (~10k sponsored students),
 *     BursaryFund + BursaryApplication (~2k awards),
 *     Refund (~3k withdrawals + fee adjustments),
 *     SlcLoan + SlcPaymentNotification + SlcFeeAssessment for UK undergrads,
 *     ApprenticeshipFundingClaim for the apprenticeship cohort.
 *     Excludes ChargeLine/StudentAccount/PaymentAllocation/JournalEntry per
 *     SCHEMA-MAPPING §3 (SJMS-is-not-an-ERP scope) — those arrive in the
 *     post-Phase-0 follow-on PR (KI-S5-205).
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'finance-student';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  ctx.log(domain, `${models.length} models declared (D1 stub — replaced in later phase)`);
}
