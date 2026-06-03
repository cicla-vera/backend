-- Add durable queue metadata without rewriting existing analysis history.
ALTER TABLE "EvidenceAnalysis"
ADD COLUMN "requestKey" TEXT,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EvidenceAnalysis_requestKey_key" ON "EvidenceAnalysis"("requestKey");
CREATE INDEX "EvidenceAnalysis_status_nextAttemptAt_idx" ON "EvidenceAnalysis"("status", "nextAttemptAt");
CREATE INDEX "EvidenceAnalysis_status_lockedAt_idx" ON "EvidenceAnalysis"("status", "lockedAt");
