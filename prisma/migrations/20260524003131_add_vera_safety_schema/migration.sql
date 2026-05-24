-- CreateEnum
CREATE TYPE "SafetyLocationType" AS ENUM ('TRUSTED', 'RISK');

-- CreateEnum
CREATE TYPE "AlertTrigger" AS ENUM ('MANUAL', 'LOCATION');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertEventType" AS ENUM ('SESSION_STARTED', 'LOCATION_ENTERED', 'EVIDENCE_UPLOADED', 'AI_ANALYSIS_COMPLETED', 'CONTACT_NOTIFIED', 'CONTACT_NOTIFICATION_FAILED', 'SESSION_CLOSED');

-- CreateTable
CREATE TABLE "SafetyProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "veraEnabled" BOOLEAN NOT NULL DEFAULT false,
    "consentAccepted" BOOLEAN NOT NULL DEFAULT false,
    "consentAcceptedAt" TIMESTAMP(3),
    "pinHash" TEXT,
    "pinUpdatedAt" TIMESTAMP(3),
    "biometricUnlockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "discreetNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "type" "SafetyLocationType" NOT NULL DEFAULT 'RISK',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "safetyLocationId" TEXT,
    "trigger" "AlertTrigger" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "initialLatitude" DOUBLE PRECISION,
    "initialLongitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertSessionId" TEXT NOT NULL,
    "type" "AlertEventType" NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SafetyProfile_userId_key" ON "SafetyProfile"("userId");

-- CreateIndex
CREATE INDEX "EmergencyContact_userId_enabled_idx" ON "EmergencyContact"("userId", "enabled");

-- CreateIndex
CREATE INDEX "EmergencyContact_userId_priority_idx" ON "EmergencyContact"("userId", "priority");

-- CreateIndex
CREATE INDEX "SafetyLocation_userId_enabled_idx" ON "SafetyLocation"("userId", "enabled");

-- CreateIndex
CREATE INDEX "SafetyLocation_userId_type_idx" ON "SafetyLocation"("userId", "type");

-- CreateIndex
CREATE INDEX "AlertSession_userId_status_idx" ON "AlertSession"("userId", "status");

-- CreateIndex
CREATE INDEX "AlertSession_userId_startedAt_idx" ON "AlertSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AlertSession_safetyLocationId_idx" ON "AlertSession"("safetyLocationId");

-- CreateIndex
CREATE INDEX "AlertEvent_alertSessionId_createdAt_idx" ON "AlertEvent"("alertSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertEvent_userId_createdAt_idx" ON "AlertEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertEvent_type_idx" ON "AlertEvent"("type");

-- AddForeignKey
ALTER TABLE "SafetyProfile" ADD CONSTRAINT "SafetyProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyLocation" ADD CONSTRAINT "SafetyLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSession" ADD CONSTRAINT "AlertSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSession" ADD CONSTRAINT "AlertSession_safetyLocationId_fkey" FOREIGN KEY ("safetyLocationId") REFERENCES "SafetyLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertSessionId_fkey" FOREIGN KEY ("alertSessionId") REFERENCES "AlertSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
