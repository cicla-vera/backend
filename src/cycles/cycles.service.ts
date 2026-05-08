import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { UpdateCycleDto } from './dto/update-cycle.dto';

const DAY_IN_MS = 1000 * 60 * 60 * 24;
const REGULARITY_THRESHOLD_DAYS = 7;

type CycleStart = {
  startDate: Date;
};

type SymptomEntryWithSymptom = {
  date: Date;
  intensity: number | null;
  symptom: {
    id: string;
    name: string;
  };
};

type SymptomPatternAccumulator = {
  symptomId: string;
  name: string;
  count: number;
  intensityTotal: number;
  intensityCount: number;
  cycleDays: number[];
  lastReportedAt: Date;
};

@Injectable()
export class CyclesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateCycleDto) {
    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;

    const duration = endDate
      ? Math.round(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : null;

    return this.prisma.cycleLog.create({
      data: {
        userId,
        startDate,
        endDate,
        duration,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const cycle = await this.prisma.cycleLog.findFirst({
      where: { id, userId },
    });

    if (!cycle) {
      throw new NotFoundException('Cycle not found');
    }

    return cycle;
  }

  async update(userId: string, id: string, dto: UpdateCycleDto) {
    await this.findOne(userId, id);

    const startDate = dto.startDate ? new Date(dto.startDate) : undefined;
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;

    let duration: number | undefined;
    if (startDate && endDate) {
      duration = Math.round(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    return this.prisma.cycleLog.update({
      where: { id },
      data: { startDate, endDate, duration },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.cycleLog.delete({ where: { id } });
  }

  async getHistory(userId: string) {
    const cycles = await this.prisma.cycleLog.findMany({
      where: { userId },
      orderBy: { startDate: 'asc' },
    });

    const cycleLengthsById = new Map<string, number>();
    for (let index = 0; index < cycles.length - 1; index += 1) {
      const currentCycle = cycles[index];
      const nextCycle = cycles[index + 1];

      cycleLengthsById.set(
        currentCycle.id,
        this.calculateDayDifference(
          currentCycle.startDate,
          nextCycle.startDate,
        ),
      );
    }

    const completeCycles = cycles.filter((cycle) => cycle.endDate !== null);
    const durations = cycles
      .map((cycle) =>
        this.getPeriodDuration(cycle.duration, cycle.startDate, cycle.endDate),
      )
      .filter((duration): duration is number => duration !== null);

    const cycleLengths = [...cycleLengthsById.values()];

    const averageDuration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    const averageCycleLength =
      cycleLengths.length > 0
        ? Math.round(
            cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length,
          )
        : null;

    const regularityVariation =
      cycleLengths.length > 0
        ? Math.max(...cycleLengths) - Math.min(...cycleLengths)
        : null;

    return {
      cycles: cycles
        .map((cycle) => ({
          ...cycle,
          periodDuration: this.getPeriodDuration(
            cycle.duration,
            cycle.startDate,
            cycle.endDate,
          ),
          cycleLength: cycleLengthsById.get(cycle.id) ?? null,
        }))
        .reverse(),
      stats: {
        totalCycles: cycles.length,
        completeCycles: completeCycles.length,
        averageDuration,
        shortest: durations.length > 0 ? Math.min(...durations) : null,
        longest: durations.length > 0 ? Math.max(...durations) : null,
        averageCycleLength,
        shortestCycleLength:
          cycleLengths.length > 0 ? Math.min(...cycleLengths) : null,
        longestCycleLength:
          cycleLengths.length > 0 ? Math.max(...cycleLengths) : null,
        regularity: this.getRegularityStatus(
          cycleLengths.length,
          regularityVariation,
        ),
      },
    };
  }

  async getInsights(userId: string) {
    const [cycles, symptomEntries] = await Promise.all([
      this.prisma.cycleLog.findMany({
        where: { userId },
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.symptomEntry.findMany({
        where: { userId },
        include: { symptom: true },
        orderBy: { date: 'desc' },
      }),
    ]);

    const cycleLengths: number[] = [];
    for (let index = 0; index < cycles.length - 1; index += 1) {
      cycleLengths.push(
        this.calculateDayDifference(
          cycles[index].startDate,
          cycles[index + 1].startDate,
        ),
      );
    }

    const completeCycles = cycles.filter((cycle) => cycle.endDate !== null);
    const periodDurations = cycles
      .map((cycle) =>
        this.getPeriodDuration(cycle.duration, cycle.startDate, cycle.endDate),
      )
      .filter((duration): duration is number => duration !== null);

    const regularityVariation =
      cycleLengths.length > 0
        ? Math.max(...cycleLengths) - Math.min(...cycleLengths)
        : null;

    const symptomPatterns = this.getSymptomPatterns(cycles, symptomEntries);

    return {
      cycles: {
        totalCycles: cycles.length,
        completeCycles: completeCycles.length,
        averageDuration: this.getAverage(periodDurations),
        averageCycleLength: this.getAverage(cycleLengths),
        regularity: this.getRegularityStatus(
          cycleLengths.length,
          regularityVariation,
        ),
      },
      symptoms: {
        totalEntries: symptomEntries.length,
        trackedSymptoms: symptomPatterns.length,
        patterns: symptomPatterns,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private calculateDayDifference(startDate: Date, endDate: Date) {
    return Math.round((endDate.getTime() - startDate.getTime()) / DAY_IN_MS);
  }

  private getPeriodDuration(
    duration: number | null,
    startDate: Date,
    endDate: Date | null,
  ) {
    if (endDate === null) {
      return null;
    }

    return duration ?? this.calculateDayDifference(startDate, endDate);
  }

  private getAverage(values: number[]) {
    if (values.length === 0) {
      return null;
    }

    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  private getSymptomPatterns(
    cycles: CycleStart[],
    symptomEntries: SymptomEntryWithSymptom[],
  ) {
    const patterns = new Map<string, SymptomPatternAccumulator>();

    for (const entry of symptomEntries) {
      const key = entry.symptom.id;
      let pattern = patterns.get(key);

      if (!pattern) {
        pattern = {
          symptomId: entry.symptom.id,
          name: entry.symptom.name,
          count: 0,
          intensityTotal: 0,
          intensityCount: 0,
          cycleDays: [],
          lastReportedAt: entry.date,
        };
        patterns.set(key, pattern);
      }

      pattern.count += 1;
      if (entry.intensity !== null) {
        pattern.intensityTotal += entry.intensity;
        pattern.intensityCount += 1;
      }

      const cycleDay = this.getCycleDayForDate(cycles, entry.date);
      if (cycleDay !== null) {
        pattern.cycleDays.push(cycleDay);
      }

      if (entry.date > pattern.lastReportedAt) {
        pattern.lastReportedAt = entry.date;
      }
    }

    return [...patterns.values()]
      .map((pattern) => ({
        symptomId: pattern.symptomId,
        name: pattern.name,
        count: pattern.count,
        averageIntensity:
          pattern.intensityCount > 0
            ? this.roundToOneDecimal(
                pattern.intensityTotal / pattern.intensityCount,
              )
            : null,
        averageCycleDay: this.getAverage(pattern.cycleDays),
        earliestCycleDay:
          pattern.cycleDays.length > 0 ? Math.min(...pattern.cycleDays) : null,
        latestCycleDay:
          pattern.cycleDays.length > 0 ? Math.max(...pattern.cycleDays) : null,
        lastReportedAt: pattern.lastReportedAt.toISOString(),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 10);
  }

  private getCycleDayForDate(cycles: CycleStart[], date: Date) {
    for (let index = cycles.length - 1; index >= 0; index -= 1) {
      const cycle = cycles[index];

      if (cycle.startDate <= date) {
        return this.calculateDayDifference(cycle.startDate, date) + 1;
      }
    }

    return null;
  }

  private roundToOneDecimal(value: number) {
    return Math.round(value * 10) / 10;
  }

  private getRegularityStatus(
    cycleLengthCount: number,
    variationDays: number | null,
  ) {
    if (cycleLengthCount < 2 || variationDays === null) {
      return {
        status: 'INSUFFICIENT_DATA',
        variationDays,
        message: 'Log at least three cycles to measure regularity.',
      };
    }

    if (variationDays <= REGULARITY_THRESHOLD_DAYS) {
      return {
        status: 'REGULAR',
        variationDays,
        message: 'Cycle lengths are within the expected variation range.',
      };
    }

    return {
      status: 'IRREGULAR',
      variationDays,
      message: 'Cycle lengths vary more than the expected range.',
    };
  }
}
