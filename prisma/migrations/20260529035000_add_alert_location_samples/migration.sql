ALTER TYPE "AlertEventType" ADD VALUE IF NOT EXISTS 'LOCATION_UPDATED';

CREATE TYPE "LocationSampleSource" AS ENUM ('FOREGROUND', 'BACKGROUND', 'UNKNOWN');

CREATE TABLE "AlertLocationSample" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertSessionId" TEXT NOT NULL,
    "evidenceRecordId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "altitudeMeters" DOUBLE PRECISION,
    "speedMetersPerSecond" DOUBLE PRECISION,
    "headingDegrees" DOUBLE PRECISION,
    "source" "LocationSampleSource" NOT NULL DEFAULT 'UNKNOWN',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLocationSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlertLocationSample_userId_capturedAt_idx" ON "AlertLocationSample"("userId", "capturedAt");

CREATE INDEX "AlertLocationSample_alertSessionId_capturedAt_idx" ON "AlertLocationSample"("alertSessionId", "capturedAt");

CREATE INDEX "AlertLocationSample_evidenceRecordId_idx" ON "AlertLocationSample"("evidenceRecordId");

CREATE INDEX "AlertLocationSample_source_idx" ON "AlertLocationSample"("source");

ALTER TABLE "AlertLocationSample" ADD CONSTRAINT "AlertLocationSample_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AlertLocationSample" ADD CONSTRAINT "AlertLocationSample_alertSessionId_fkey" FOREIGN KEY ("alertSessionId") REFERENCES "AlertSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AlertLocationSample" ADD CONSTRAINT "AlertLocationSample_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "EvidenceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
