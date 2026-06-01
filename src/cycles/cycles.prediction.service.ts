import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_IN_MS = 1000 * 60 * 60 * 24;
const DEFAULT_CYCLE_LENGTH_DAYS = 28;
const OVULATION_OFFSET_DAYS = 14;
const FERTILE_WINDOW_DAYS_BEFORE_OVULATION = 5;
const FERTILE_WINDOW_DAYS_AFTER_OVULATION = 1;

type CycleForPrediction = {
  startDate: Date;
};

@Injectable()
export class CyclesPredictionService {
  constructor(private prisma: PrismaService) {}

  async predict(userId: string) {
    const [cycles, profile] = await Promise.all([
      this.prisma.cycleLog.findMany({
        where: { userId },
        orderBy: { startDate: 'desc' },
        take: 6,
      }),
      this.prisma.profile.findUnique({
        where: { userId },
        select: { avgCycleLength: true },
      }),
    ]);

    const completeCycles = cycles.filter((cycle) => cycle.endDate !== null);

    if (completeCycles.length === 0) {
      return {
        nextPeriod: null,
        ovulationDate: null,
        fertileWindow: null,
        message:
          'Not enough data to predict. Log at least one complete cycle (with start and end dates).',
      };
    }

    const averageCycleLength =
      this.getAverageCycleLength(cycles) ??
      profile?.avgCycleLength ??
      DEFAULT_CYCLE_LENGTH_DAYS;

    const lastCycle = cycles[0];
    const lastStartDate = new Date(lastCycle.startDate);

    const nextPeriodDate = new Date(lastStartDate);
    nextPeriodDate.setDate(nextPeriodDate.getDate() + averageCycleLength);

    const ovulationDate = new Date(nextPeriodDate);
    ovulationDate.setDate(ovulationDate.getDate() - OVULATION_OFFSET_DAYS);

    const fertileStart = new Date(ovulationDate);
    fertileStart.setDate(
      fertileStart.getDate() - FERTILE_WINDOW_DAYS_BEFORE_OVULATION,
    );

    const fertileEnd = new Date(ovulationDate);
    fertileEnd.setDate(
      fertileEnd.getDate() + FERTILE_WINDOW_DAYS_AFTER_OVULATION,
    );

    const today = new Date();
    const daysUntilNextPeriod = this.calculateDayDifference(
      today,
      nextPeriodDate,
    );

    const currentCycleDay =
      this.calculateDayDifference(lastStartDate, today) + 1;

    return {
      averageCycleLength,
      currentCycleDay,
      daysUntilNextPeriod,
      nextPeriod: {
        date: nextPeriodDate.toISOString().split('T')[0],
        daysUntil: daysUntilNextPeriod,
      },
      ovulationDate: {
        date: ovulationDate.toISOString().split('T')[0],
      },
      fertileWindow: {
        start: fertileStart.toISOString().split('T')[0],
        end: fertileEnd.toISOString().split('T')[0],
      },
      basedOnCycles: cycles.length,
    };
  }

  private getAverageCycleLength(cycles: CycleForPrediction[]) {
    if (cycles.length < 2) {
      return null;
    }

    const cycleStarts = [...cycles]
      .map((cycle) => cycle.startDate)
      .sort((left, right) => left.getTime() - right.getTime());

    const cycleLengths: number[] = [];

    for (let index = 1; index < cycleStarts.length; index += 1) {
      cycleLengths.push(
        this.calculateDayDifference(cycleStarts[index - 1], cycleStarts[index]),
      );
    }

    return Math.round(
      cycleLengths.reduce((total, length) => total + length, 0) /
        cycleLengths.length,
    );
  }

  private calculateDayDifference(startDate: Date, endDate: Date) {
    const start = Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate(),
    );
    const end = Date.UTC(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth(),
      endDate.getUTCDate(),
    );

    return Math.round((end - start) / DAY_IN_MS);
  }
}
