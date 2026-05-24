-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('AUDIO', 'VIDEO', 'IMAGE', 'FILE');

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertSessionId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT,
    "storagePath" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_storagePath_key" ON "EvidenceRecord"("storagePath");

-- CreateIndex
CREATE INDEX "EvidenceRecord_userId_createdAt_idx" ON "EvidenceRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceRecord_alertSessionId_createdAt_idx" ON "EvidenceRecord"("alertSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceRecord_type_idx" ON "EvidenceRecord"("type");

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_alertSessionId_fkey" FOREIGN KEY ("alertSessionId") REFERENCES "AlertSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
