/**
 * finance-student generator (D9)
 *
 * Volumes:
 *   Fee                          ~80,000 (one per enrolment × fee type)
 *   Invoice                      ~80,000
 *   Payment                     ~120,000 (mix instalments + sponsor + SLC)
 *   PaymentTransaction          ~120,000
 *   PaymentPlan                  ~24,000 (~30% of students)
 *   SponsorRecord                ~10,000
 *   SponsorPayment               ~30,000
 *   BursaryFund                       8
 *   BursaryApplication            ~5,000
 *   FundingApplication            ~2,000
 *   Debt                          ~5,000
 *   Refund                        ~3,000
 *   SlcLoan                      ~30,000 (UK undergrads)
 *   SlcPaymentNotification       ~90,000 (3 per loan per year)
 *   SlcFeeAssessment             ~30,000
 *   ApprenticeshipFundingClaim    ~5,000 (4 per registration × 5 quarters)
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'finance-student';

const FEE_BY_LEVEL = { UG: 9_250, PGT: 11_500, PGR: 5_000 };
const OVERSEAS_PREMIUM = 16_000;
const BATCH = 5000;
const flush = (ctx, model, batch) => { if (batch.length) { ctx.append(model, batch); batch.length = 0; } };

const BURSARY_NAMES = [
  ['Vice-Chancellor\'s Scholarship', 200_000],
  ['Future Horizons Hardship Fund', 150_000],
  ['Care Leavers Bursary', 80_000],
  ['Estranged Students Fund', 50_000],
  ['STEM Excellence Scholarship', 250_000],
  ['Sports Performance Scholarship', 100_000],
  ['Music Performance Award', 60_000],
  ['Widening Participation Bursary', 350_000],
];

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const audit = ctx.audit(now);
  const rng = ctx.rng.fork('finance-student');

  // 1. Bursary funds
  const bursaryIds = [];
  ctx.append('BursaryFund', BURSARY_NAMES.map(([name, totalFunding], i) => {
    const id = `bf-${(i + 1).toString().padStart(3, '0')}`;
    bursaryIds.push(id);
    return {
      id, ...audit,
      name, description: `${name} — funded annually from institutional reserves and donor income.`,
      totalFunding: totalFunding.toFixed(2), currency: 'GBP',
      academicYear: '2025/26',
    };
  }));

  // Pre-index for O(1) lookup (avoids 78k × 52k = 4B-op nested loops)
  const studentById = new Map();
  for (const s of ctx.ids.studentIds) studentById.set(s.id, s);
  const ayLabelById = new Map();
  for (const a of ctx.ids.academicYears) ayLabelById.set(a.id, a.label);

  // 2. Fee + Invoice + Payment per enrolment
  let feeBatch = [], invBatch = [], payBatch = [], txnBatch = [], planBatch = [];
  let feeSeq = 0, payCounter = 0;
  for (const en of ctx.ids.enrolmentIds) {
    const stu = studentById.get(en.studentId);
    if (!stu) continue;
    const baseAmount = FEE_BY_LEVEL[stu.level] ?? 9_250;
    const amount = stu.fee === 'OVERSEAS' ? OVERSEAS_PREMIUM : baseAmount;
    const ayLabel = ayLabelById.get(en.ayId) ?? '2025/26';
    feeSeq += 1;
    const feeId = `fee-${feeSeq.toString().padStart(8, '0')}`;
    const invId = `inv-${feeSeq.toString().padStart(8, '0')}`;
    const dueDate = `${2000 + parseInt(ayLabel.split('/')[1], 10) - 1}-09-30T00:00:00Z`;
    const isPaid = en.status === 'COMPLETED';
    feeBatch.push({
      id: feeId, ...audit,
      applicationId: null, enrolmentId: en.id, studentId: stu.id,
      feeType: 'TUITION', amount: amount.toFixed(2), currency: 'GBP',
      academicYear: ayLabel, status: isPaid ? 'PAID' : 'OUTSTANDING',
      dueDate, paidDate: isPaid ? dueDate : null,
      description: `Tuition fee — ${ayLabel}`, tenantId: ctx.tenantId,
    });
    invBatch.push({
      id: invId, ...audit,
      feeId, invoiceNumber: `INV-${ayLabel.replace('/', '')}-${feeSeq.toString().padStart(8, '0')}`,
      invoiceDate: dueDate, dueDate,
      totalAmount: amount.toFixed(2), currency: 'GBP',
      paidAmount: isPaid ? amount.toFixed(2) : '0.00',
    });

    // Payment plan if SLC-funded or self-funded
    const fundingSource = en.fundingSource ?? 'SELF_FUNDED';
    if (fundingSource === 'SELF_FUNDED' && rng.chance(0.4)) {
      planBatch.push({
        id: `pp-${feeId.slice(4)}`, ...audit,
        studentId: stu.id, feeId, totalAmount: amount.toFixed(2),
        installmentAmount: Math.round(amount / 3).toFixed(2),
        numberOfInstallments: 3,
        startDate: dueDate, endDate: dueDate.replace(`-09-30`, `-12-30`),
      });
      // 3 instalment payments
      for (let pi = 0; pi < 3; pi++) {
        payCounter += 1;
        const payId = `pay-${payCounter.toString().padStart(8, '0')}`;
        payBatch.push({
          id: payId, ...audit,
          feeId, invoiceId: invId,
          amount: Math.round(amount / 3).toFixed(2),
          currency: 'GBP',
          paymentDate: dueDate.replace(`-09-30`, `-${10 + pi}-15`),
          paymentMethod: rng.weighted([['CARD', 70], ['BANK_TRANSFER', 25], ['CASH', 5]]),
          reference: `INST${pi + 1}-${feeId.slice(4)}`,
          status: isPaid || pi < 2 ? 'COMPLETED' : 'PENDING',
        });
        txnBatch.push({
          id: `txn-${payCounter.toString().padStart(8, '0')}`,
          createdAt: now, updatedAt: now,
          createdBy: ctx.seedActor, updatedBy: ctx.seedActor,
          paymentId: payId, transactionId: `TXN${payCounter}`,
          amount: Math.round(amount / 3).toFixed(2), currency: 'GBP',
          status: 'COMPLETED', responseCode: '00', errorMessage: null,
        });
      }
    } else {
      // Single payment (SLC or sponsor)
      payCounter += 1;
      const payId = `pay-${payCounter.toString().padStart(8, '0')}`;
      payBatch.push({
        id: payId, ...audit,
        feeId, invoiceId: invId,
        amount: amount.toFixed(2), currency: 'GBP', paymentDate: dueDate,
        paymentMethod: fundingSource === 'SLC' ? 'SLC' : 'BANK_TRANSFER',
        reference: `${fundingSource}-${feeId.slice(4)}`,
        status: isPaid ? 'COMPLETED' : 'PENDING',
      });
      txnBatch.push({
        id: `txn-${payCounter.toString().padStart(8, '0')}`,
        createdAt: now, updatedAt: now,
        createdBy: ctx.seedActor, updatedBy: ctx.seedActor,
        paymentId: payId, transactionId: `TXN${payCounter}`,
        amount: amount.toFixed(2), currency: 'GBP',
        status: 'COMPLETED', responseCode: '00', errorMessage: null,
      });
    }

    if (feeBatch.length >= BATCH) {
      flush(ctx, 'Fee', feeBatch); flush(ctx, 'Invoice', invBatch);
      flush(ctx, 'Payment', payBatch); flush(ctx, 'PaymentTransaction', txnBatch);
      flush(ctx, 'PaymentPlan', planBatch);
    }
  }
  flush(ctx, 'Fee', feeBatch); flush(ctx, 'Invoice', invBatch);
  flush(ctx, 'Payment', payBatch); flush(ctx, 'PaymentTransaction', txnBatch);
  flush(ctx, 'PaymentPlan', planBatch);
  ctx.log(domain, `${feeSeq.toLocaleString()} fees, ${payCounter.toLocaleString()} payments`);

  // 3. SponsorRecord + SponsorPayment for sponsored enrolments
  let spBatch = [], spPayBatch = [], spSeq = 0;
  for (const en of ctx.ids.enrolmentIds) {
    if (en.fundingSource !== 'SPONSORED') continue;
    spSeq += 1;
    const spId = `sp-${spSeq.toString().padStart(6, '0')}`;
    spBatch.push({
      id: spId, ...audit,
      enrolmentId: en.id, sponsorName: 'Corporate Sponsor Ltd',
      sponsorType: rng.weighted([['GOVERNMENT', 30], ['EMPLOYER', 50], ['PRIVATE', 20]]),
      fundingAmount: 9_250, currency: 'GBP',
      academicYear: ayLabelById.get(en.ayId) ?? '2025/26',
    });
    spPayBatch.push({
      id: `sppay-${spSeq.toString().padStart(6, '0')}`, ...audit,
      sponsorId: spId, paymentDate: now, amount: 9_250, currency: 'GBP',
      reference: `SP-${spSeq}`,
    });
    if (spBatch.length >= BATCH) {
      flush(ctx, 'SponsorRecord', spBatch);
      flush(ctx, 'SponsorPayment', spPayBatch);
    }
  }
  flush(ctx, 'SponsorRecord', spBatch);
  flush(ctx, 'SponsorPayment', spPayBatch);

  // 4. BursaryApplication + FundingApplication (~5k)
  const bursaryAppRows = [];
  const fundingAppRows = [];
  const samples = rng.pickN(ctx.ids.studentIds, Math.min(5000, ctx.ids.studentIds.length));
  for (const stu of samples) {
    bursaryAppRows.push({
      id: `ba-${stu.id.slice(4)}`, ...audit,
      studentId: stu.id, fundId: rng.pick(bursaryIds),
      applicationDate: '2025-08-15T00:00:00Z',
      awardAmount: rng.weighted([[2000, 30], [1500, 30], [1000, 20], [0, 20]]).toFixed(2),
      status: rng.weighted([['AWARDED', 60], ['UNSUCCESSFUL', 25], ['PENDING', 15]]),
    });
    if (rng.chance(0.4)) {
      fundingAppRows.push({
        id: `fa-${stu.id.slice(4)}`, ...audit,
        studentId: stu.id, fundingType: rng.pick(['HARDSHIP', 'EMERGENCY', 'EQUIPMENT']),
        applicationDate: '2025-09-15T00:00:00Z',
        approvalDate: rng.chance(0.7) ? '2025-10-01T00:00:00Z' : null,
        fundingAmount: rng.weighted([[1000, 50], [500, 30], [2000, 20]]).toFixed(2),
        currency: 'GBP',
        status: rng.weighted([['APPROVED', 65], ['REJECTED', 20], ['PENDING', 15]]),
      });
    }
  }
  ctx.append('BursaryApplication', bursaryAppRows);
  ctx.append('FundingApplication', fundingAppRows);

  // 5. Debts (~5k)
  const debtRows = [];
  for (let i = 0; i < 5000; i++) {
    const stu = ctx.ids.studentIds[i * 10 % ctx.ids.studentIds.length];
    debtRows.push({
      id: `debt-${(i + 1).toString().padStart(5, '0')}`, ...audit,
      studentId: stu.id, amount: rng.int(500, 9250).toFixed(2),
      currency: 'GBP', debtType: 'TUITION',
      createdDate: '2025-10-01T00:00:00Z',
      dueDate: '2026-04-30T00:00:00Z',
      settledDate: rng.chance(0.6) ? '2026-03-15T00:00:00Z' : null,
    });
  }
  ctx.append('Debt', debtRows);

  // 6. Refunds (~3k — withdrawals + adjustments)
  const refundRows = [];
  for (let i = 0; i < 3000; i++) {
    const stu = ctx.ids.studentIds[i * 15 % ctx.ids.studentIds.length];
    refundRows.push({
      id: `ref-${(i + 1).toString().padStart(5, '0')}`, ...audit,
      studentId: stu.id, amount: rng.int(500, 9250).toFixed(2),
      currency: 'GBP', reason: rng.pick(['WITHDRAWAL', 'FEE_ADJUSTMENT', 'OVERPAYMENT', 'HARDSHIP']),
      requestDate: '2025-11-01T00:00:00Z',
      approvalDate: '2025-11-15T00:00:00Z',
      refundDate: '2025-12-01T00:00:00Z',
      status: 'PROCESSED',
    });
  }
  ctx.append('Refund', refundRows);

  // 7. SlcLoan + SlcPaymentNotification + SlcFeeAssessment for UK UG students
  let slcBatch = [], slcNotBatch = [], slcAssBatch = [], slcSeq = 0;
  for (const en of ctx.ids.enrolmentIds) {
    const stu = studentById.get(en.studentId);
    if (!stu || stu.level !== 'UG' || stu.fee !== 'HOME') continue;
    if (en.fundingSource !== 'SLC') continue;
    slcSeq += 1;
    const slcRef = `SLC${slcSeq.toString().padStart(8, '0')}`;
    const ayLabel = ayLabelById.get(en.ayId) ?? '2025/26';
    slcBatch.push({
      id: `slc-${slcSeq.toString().padStart(7, '0')}`,
      createdAt: now, updatedAt: now, createdBy: ctx.seedActor, updatedBy: ctx.seedActor,
      slcReference: slcRef, studentId: stu.id,
      loanType: 'TUITION_FEE_LOAN', amount: 9_250.00.toFixed(2),
      status: 'APPROVED', academicYear: ayLabel,
    });
    slcAssBatch.push({
      id: `slcass-${slcSeq.toString().padStart(7, '0')}`,
      createdAt: now, updatedAt: now,
      studentId: stu.id, academicYear: ayLabel,
      assessedAmount: 9_250.00.toFixed(2),
      tuitionFee: 9_250.00.toFixed(2),
      maintenanceLoan: rng.int(3500, 12000).toFixed(2),
      status: 'CONFIRMED',
    });
    // 3 termly payment notifications
    for (let term = 0; term < 3; term++) {
      slcNotBatch.push({
        id: `slcnot-${slcSeq.toString().padStart(7, '0')}-t${term + 1}`,
        createdAt: now, updatedAt: now, slcReference: slcRef,
        paymentDate: `${2000 + parseInt(ayLabel.split('/')[1], 10) - (term === 0 ? 1 : 0)}-${10 + term}-15T00:00:00Z`,
        amount: (9250 / 3).toFixed(2), paymentType: 'TUITION_FEE',
        processedAt: now,
      });
    }
    if (slcBatch.length >= BATCH) {
      flush(ctx, 'SlcLoan', slcBatch);
      flush(ctx, 'SlcPaymentNotification', slcNotBatch);
      flush(ctx, 'SlcFeeAssessment', slcAssBatch);
    }
  }
  flush(ctx, 'SlcLoan', slcBatch);
  flush(ctx, 'SlcPaymentNotification', slcNotBatch);
  flush(ctx, 'SlcFeeAssessment', slcAssBatch);

  // 8. ApprenticeshipFundingClaim — 4 per quarter per active registration
  const apFundRows = [];
  // Get apprentice ids from ApprenticeshipRegistration emitted in D6
  // (We don't track them in ctx.ids; approximate by re-using student count × 5%)
  const sampleApprentices = ctx.ids.studentIds.filter(s => s.level === 'UG').slice(0, 1200);
  for (const stu of sampleApprentices) {
    for (let q = 0; q < 4; q++) {
      apFundRows.push({
        id: `afc-${stu.id.slice(4)}-q${q + 1}`,
        createdAt: now, updatedAt: now,
        registrationId: `apr-${stu.id.slice(4)}`,
        claimPeriod: `Q${q + 1} 2025/26`,
        amount: 5_400.00.toFixed(2),
        claimType: 'ON_PROGRAMME',
        status: q < 3 ? 'PAID' : 'SUBMITTED',
        ilrReference: `ILR-${stu.id.slice(-6)}-Q${q + 1}`,
        submittedAt: now, paidAt: q < 3 ? now : null,
      });
    }
  }
  ctx.append('ApprenticeshipFundingClaim', apFundRows);

  ctx.log(domain,
    `${feeSeq.toLocaleString()} fees, ${payCounter.toLocaleString()} payments, ${spSeq.toLocaleString()} sponsors, ${slcSeq.toLocaleString()} SLC loans, ${apFundRows.length.toLocaleString()} apprenticeship claims`);
}
