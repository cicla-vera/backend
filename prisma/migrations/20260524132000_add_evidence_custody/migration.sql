-- CreateEnum
CREATE TYPE "EvidenceAuditAction" AS ENUM ('UPLOADED', 'HASH_VERIFIED');

-- AlterTable
ALTER TABLE "EvidenceRecord" ADD COLUMN     "contentHash" TEXT NOT NULL DEFAULT 'legacy-unverified',
ADD COLUMN     "hashAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
ADD COLUMN     "hashedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "EvidenceRecord" ALTER COLUMN "contentHash" DROP DEFAULT;

-- CreateTable
CREATE TABLE "EvidenceAuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evidenceRecordId" TEXT NOT NULL,
    "action" "EvidenceAuditAction" NOT NULL,
    "contentHash" TEXT,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    "previousEventHash" TEXT,
    "eventHash" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceRecord_contentHash_idx" ON "EvidenceRecord"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceAuditEvent_eventHash_key" ON "EvidenceAuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "EvidenceAuditEvent_userId_createdAt_idx" ON "EvidenceAuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceAuditEvent_evidenceRecordId_createdAt_idx" ON "EvidenceAuditEvent"("evidenceRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceAuditEvent_action_idx" ON "EvidenceAuditEvent"("action");

-- AddForeignKey
ALTER TABLE "EvidenceAuditEvent" ADD CONSTRAINT "EvidenceAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceAuditEvent" ADD CONSTRAINT "EvidenceAuditEvent_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
