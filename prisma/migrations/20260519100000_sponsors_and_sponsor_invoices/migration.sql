-- Phase 1B — normalised Sponsor entity and SponsorInvoice ledger surface.
--
-- Three additive schema changes that introduce a proper sponsor system of
-- record for FHE University:
--
-- 1.  sponsors
--     A normalised organisation row (one per sponsoring entity — e.g. the
--     Student Loans Company, a foreign embassy, an employer). Until now
--     the SponsorAgreement table embedded `sponsor_name` and
--     `sponsor_type` directly on every agreement row, so the same sponsor
--     could appear under inconsistent names across student accounts. The
--     denormalised columns are preserved (see point 3) so existing rows
--     keep working — the new FK is additive.
--
-- 2.  sponsor_invoices
--     The billing ledger from FHE to the sponsor. Distinct from the
--     student-facing `invoices` table because the sponsor's accounts
--     payable lives outside the StudentAccount domain (no chargeline
--     decomposition, no student-account balance). Each row optionally
--     references a SponsorAgreement so an invoice can be raised against
--     a specific tranche, or left null for general sponsor billing.
--     Status enum mirrors the existing InvoiceStatus surface but adds
--     OVERDUE explicitly because sponsors are billed on net-30 terms.
--
-- 3.  sponsor_agreements.sponsor_id
--     Nullable FK pointing at sponsors.id. Existing agreements stay
--     valid (sponsor_id = NULL is permitted) and a follow-on backfill
--     pass (deliberately not in this batch) can resolve the legacy
--     `sponsor_name` columns into Sponsor rows once the operator-facing
--     UI for Sponsor management is live.

-- 1. SponsorInvoiceStatus enum  ────────────────────────────────────────────
CREATE TYPE "SponsorInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- 2. sponsors  ─────────────────────────────────────────────────────────────
CREATE TABLE "sponsors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sponsor_type" "SponsorType" NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "postcode" TEXT,
    "country" TEXT,
    "tax_ref" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sponsors_sponsor_type_idx" ON "sponsors"("sponsor_type");
CREATE INDEX "sponsors_is_active_idx" ON "sponsors"("is_active");

-- 3. sponsor_agreements.sponsor_id  (additive nullable FK) ─────────────────
ALTER TABLE "sponsor_agreements" ADD COLUMN "sponsor_id" TEXT;
CREATE INDEX "sponsor_agreements_sponsor_id_idx" ON "sponsor_agreements"("sponsor_id");
ALTER TABLE "sponsor_agreements"
    ADD CONSTRAINT "sponsor_agreements_sponsor_id_fkey"
    FOREIGN KEY ("sponsor_id") REFERENCES "sponsors"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. sponsor_invoices  ─────────────────────────────────────────────────────
CREATE TABLE "sponsor_invoices" (
    "id" TEXT NOT NULL,
    "sponsor_id" TEXT NOT NULL,
    "sponsor_agreement_id" TEXT,
    "invoice_number" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "academic_year" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "status" "SponsorInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "sent_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sponsor_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sponsor_invoices_invoice_number_key" ON "sponsor_invoices"("invoice_number");
CREATE INDEX "sponsor_invoices_sponsor_id_idx" ON "sponsor_invoices"("sponsor_id");
CREATE INDEX "sponsor_invoices_sponsor_agreement_id_idx" ON "sponsor_invoices"("sponsor_agreement_id");
CREATE INDEX "sponsor_invoices_status_idx" ON "sponsor_invoices"("status");
CREATE INDEX "sponsor_invoices_academic_year_idx" ON "sponsor_invoices"("academic_year");

ALTER TABLE "sponsor_invoices"
    ADD CONSTRAINT "sponsor_invoices_sponsor_id_fkey"
    FOREIGN KEY ("sponsor_id") REFERENCES "sponsors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sponsor_invoices"
    ADD CONSTRAINT "sponsor_invoices_sponsor_agreement_id_fkey"
    FOREIGN KEY ("sponsor_agreement_id") REFERENCES "sponsor_agreements"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
