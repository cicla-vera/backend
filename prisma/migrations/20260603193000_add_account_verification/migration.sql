-- CreateEnum
CREATE TYPE "AccountVerificationChannel" AS ENUM ('EMAIL', 'PHONE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountVerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "AccountVerificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountVerificationCode_userId_channel_createdAt_idx" ON "AccountVerificationCode"("userId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "AccountVerificationCode_userId_channel_expiresAt_idx" ON "AccountVerificationCode"("userId", "channel", "expiresAt");

-- CreateIndex
CREATE INDEX "AccountVerificationCode_destination_channel_createdAt_idx" ON "AccountVerificationCode"("destination", "channel", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountVerificationCode" ADD CONSTRAINT "AccountVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
