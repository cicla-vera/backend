-- CreateEnum
CREATE TYPE "EvidenceChunkChainStatus" AS ENUM ('NOT_APPLICABLE', 'ROOT', 'VERIFIED', 'PENDING_PREVIOUS');

-- AlterEnum
ALTER TYPE "EvidenceAuditAction" ADD VALUE 'CHUNK_CHAIN_VERIFIED';

-- AlterTable
ALTER TABLE "EvidenceRecord"
ADD COLUMN "clientUploadId" TEXT,
ADD COLUMN "chunkSequenceId" TEXT,
ADD COLUMN "chunkIndex" INTEGER,
ADD COLUMN "previousChunkHash" TEXT,
ADD COLUMN "chunkChainStatus" "EvidenceChunkChainStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_userId_clientUploadId_key" ON "EvidenceRecord"("userId", "clientUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_alertSessionId_chunkSequenceId_chunkIndex_key" ON "EvidenceRecord"("alertSessionId", "chunkSequenceId", "chunkIndex");

-- CreateIndex
CREATE INDEX "EvidenceRecord_alertSessionId_chunkSequenceId_chunkIndex_idx" ON "EvidenceRecord"("alertSessionId", "chunkSequenceId", "chunkIndex");

-- CreateIndex
CREATE INDEX "EvidenceRecord_chunkChainStatus_idx" ON "EvidenceRecord"("chunkChainStatus");
