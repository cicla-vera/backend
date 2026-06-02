/*
  Warnings:

  - A unique constraint covering the columns `[cpf]` on the table `Profile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "avgCycleLength" INTEGER,
ADD COLUMN     "avgPeriodDuration" INTEGER,
ADD COLUMN     "cpf" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Profile_cpf_key" ON "Profile"("cpf");
