ALTER TABLE "SafetyLocation"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "formattedAddress" TEXT,
  ADD COLUMN "placeId" TEXT,
  ADD COLUMN "addressSource" TEXT;

CREATE TABLE "VeraLocationSample" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "alertSessionId" TEXT,
  "safetyLocationId" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracyMeters" DOUBLE PRECISION,
  "altitudeMeters" DOUBLE PRECISION,
  "speedMetersPerSecond" DOUBLE PRECISION,
  "headingDegrees" DOUBLE PRECISION,
  "source" "LocationSampleSource" NOT NULL DEFAULT 'UNKNOWN',
  "monitoringState" TEXT,
  "address" TEXT,
  "formattedAddress" TEXT,
  "placeId" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VeraLocationSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VeraLocationSample_userId_capturedAt_idx" ON "VeraLocationSample"("userId", "capturedAt");
CREATE INDEX "VeraLocationSample_alertSessionId_capturedAt_idx" ON "VeraLocationSample"("alertSessionId", "capturedAt");
CREATE INDEX "VeraLocationSample_safetyLocationId_capturedAt_idx" ON "VeraLocationSample"("safetyLocationId", "capturedAt");
CREATE INDEX "VeraLocationSample_source_idx" ON "VeraLocationSample"("source");
CREATE INDEX "VeraLocationSample_monitoringState_idx" ON "VeraLocationSample"("monitoringState");

ALTER TABLE "VeraLocationSample" ADD CONSTRAINT "VeraLocationSample_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VeraLocationSample" ADD CONSTRAINT "VeraLocationSample_alertSessionId_fkey" FOREIGN KEY ("alertSessionId") REFERENCES "AlertSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VeraLocationSample" ADD CONSTRAINT "VeraLocationSample_safetyLocationId_fkey" FOREIGN KEY ("safetyLocationId") REFERENCES "SafetyLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
