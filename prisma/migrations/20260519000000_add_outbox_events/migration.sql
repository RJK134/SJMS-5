-- Batch 0L — transactional outbox for atomic event delivery.
-- Every business mutation that emits an event will write a PENDING row
-- here inside its prisma.$transaction. A separate BullMQ worker drains
-- PENDING rows and dispatches to n8n.

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'DELIVERED', 'FAILED', 'DISCARDED');

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "request_id" TEXT,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "error_message" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_event_name_idx" ON "outbox_events"("event_name");

-- CreateIndex
CREATE INDEX "outbox_events_entity_type_entity_id_idx" ON "outbox_events"("entity_type", "entity_id");
