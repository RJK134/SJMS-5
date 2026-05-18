-- Phase 18C review fixes.
--
-- Two additive schema changes to close the correctness gaps identified
-- in the Phase 18C payment-allocation code review:
--
-- 1.  charge_lines.paid_amount
--     Tracks the amount already applied against a ChargeLine by prior
--     payment-allocation runs.  The payment-allocation pipeline reads
--     this column as `alreadyAllocated` and passes it into the pure
--     `allocatePayment` utility so that outstanding = amount − paidAmount
--     is computed correctly on every run.  The column is incremented
--     (never set) by the pipeline so that concurrent partial allocations
--     from different payments accumulate safely.  Fully-covered charges
--     (status = PAID) also have paidAmount = amount after the run that
--     closed them; partially-covered charges retain paidAmount < amount
--     and remain PENDING / INVOICED until a subsequent run covers them.
--     Default 0 is backward-compatible: existing rows behave as if no
--     prior allocation has been applied.
--
-- 2.  payments.allocated_at
--     Nullable timestamp stamped by the allocation pipeline after a
--     successful persist run.  Acts as an idempotency marker: a payment
--     whose allocated_at is not null cannot be re-allocated without an
--     explicit force flag.  This prevents the ledger (StudentAccount.
--     balance / totalCredits) from being double-decremented / double-
--     incremented if the same allocation endpoint is called twice.
--     Null means the payment has never been persisted through the
--     allocation pipeline (existing rows are unaffected).

-- 1. charge_lines.paid_amount  — NOT NULL with DEFAULT 0
ALTER TABLE "charge_lines"
  ADD COLUMN "paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- 2. payments.allocated_at  — nullable, no default
ALTER TABLE "payments"
  ADD COLUMN "allocated_at" TIMESTAMP(3);
