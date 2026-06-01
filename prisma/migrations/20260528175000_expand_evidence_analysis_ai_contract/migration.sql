-- AlterEnum
ALTER TYPE "EvidenceAnalysisStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "EvidenceAnalysisStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "EvidenceAnalysisStatus" ADD VALUE IF NOT EXISTS 'INCONCLUSIVE';

-- AlterTable
ALTER TABLE "EvidenceAnalysis"
    ADD COLUMN "analysisId" TEXT,
    ADD COLUMN "analysisVersion" TEXT,
    ADD COLUMN "recommendedAction" TEXT,
    ADD COLUMN "evidenceWindow" JSONB,
    ADD COLUMN "transcription" JSONB,
    ADD COLUMN "acousticEvents" JSONB,
    ADD COLUMN "threatMatches" JSONB,
    ADD COLUMN "providerMetadata" JSONB,
    ADD COLUMN "processingStartedAt" TIMESTAMP(3),
    ADD COLUMN "processingFinishedAt" TIMESTAMP(3),
    ADD COLUMN "latencyMs" INTEGER,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
