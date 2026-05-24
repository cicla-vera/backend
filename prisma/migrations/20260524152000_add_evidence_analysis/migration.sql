-- CreateEnum
CREATE TYPE "EvidenceAnalysisStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "EvidenceAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertSessionId" TEXT NOT NULL,
    "evidenceRecordId" TEXT NOT NULL,
    "status" "EvidenceAnalysisStatus" NOT NULL,
    "riskLevel" TEXT,
    "suggestedAlertLevel" "AlertLevel",
    "confidence" DOUBLE PRECISION,
    "summary" TEXT,
    "detectedSignals" JSONB,
    "shouldEscalate" BOOLEAN,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceAnalysis_userId_createdAt_idx" ON "EvidenceAnalysis"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceAnalysis_alertSessionId_createdAt_idx" ON "EvidenceAnalysis"("alertSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceAnalysis_evidenceRecordId_createdAt_idx" ON "EvidenceAnalysis"("evidenceRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceAnalysis_status_idx" ON "EvidenceAnalysis"("status");

-- CreateIndex
CREATE INDEX "EvidenceAnalysis_suggestedAlertLevel_idx" ON "EvidenceAnalysis"("suggestedAlertLevel");

-- AddForeignKey
ALTER TABLE "EvidenceAnalysis" ADD CONSTRAINT "EvidenceAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceAnalysis" ADD CONSTRAINT "EvidenceAnalysis_alertSessionId_fkey" FOREIGN KEY ("alertSessionId") REFERENCES "AlertSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceAnalysis" ADD CONSTRAINT "EvidenceAnalysis_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
