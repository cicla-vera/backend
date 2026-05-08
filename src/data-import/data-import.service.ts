import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ActivityIntensity,
  ActivityType,
  FlowIntensity,
  MoodType,
  SleepQuality,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ImportCounters = {
  cycles: number;
  flowEntries: number;
  symptomEntries: number;
  moodEntries: number;
  notes: number;
  temperatureEntries: number;
  weightEntries: number;
  waterEntries: number;
  activityEntries: number;
  sleepEntries: number;
  intercourseEntries: number;
  medicationEntries: number;
  skipped: number;
};

type JsonRecord = Record<string, unknown>;

const DAY_IN_MS = 1000 * 60 * 60 * 24;

@Injectable()
export class DataImportService {
  constructor(private prisma: PrismaService) {}

  async importFlo(userId: string, payload: unknown) {
    if (!this.isRecord(payload) && !Array.isArray(payload)) {
      throw new BadRequestException(
        'Flo import payload must be a JSON object.',
      );
    }

    const counters = this.createCounters();
    const allRecords = this.collectRecords(payload);

    await this.importCycles(userId, payload, counters);
    await this.importFlowEntries(userId, payload, allRecords, counters);
    await this.importSymptomEntries(userId, payload, allRecords, counters);
    await this.importMoodEntries(userId, payload, allRecords, counters);
    await this.importNotes(userId, payload, allRecords, counters);
    await this.importTemperatureEntries(userId, payload, allRecords, counters);
    await this.importWeightEntries(userId, payload, allRecords, counters);
    await this.importWaterEntries(userId, payload, allRecords, counters);
    await this.importActivityEntries(userId, payload, allRecords, counters);
    await this.importSleepEntries(userId, payload, allRecords, counters);
    await this.importIntercourseEntries(userId, payload, allRecords, counters);
    await this.importMedicationEntries(userId, payload, allRecords, counters);

    return {
      source: 'flo',
      imported: counters,
      processedRecords: allRecords.length,
      generatedAt: new Date().toISOString(),
    };
  }

  private async importCycles(
    userId: string,
    payload: unknown,
    counters: ImportCounters,
  ) {
    const allRecords = this.collectRecords(payload);
    const cycleRecords = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'cycles',
        'cycleLogs',
        'periods',
        'periodLogs',
        'menstruation',
        'menstruations',
      ]),
      this.filterRecordsByType(allRecords, ['cycle', 'period', 'menstruation']),
    );

    for (const record of cycleRecords) {
      const startDate = this.getDate(record, [
        'startDate',
        'startedAt',
        'periodStart',
        'periodStartDate',
        'from',
        'start',
        'date',
      ]);

      if (!startDate) {
        counters.skipped += 1;
        continue;
      }

      const endDate =
        this.getDate(record, [
          'endDate',
          'endedAt',
          'periodEnd',
          'periodEndDate',
          'to',
          'end',
        ]) ?? this.getEndDateFromDuration(record, startDate);

      await this.prisma.cycleLog.create({
        data: {
          userId,
          startDate,
          endDate,
          duration: endDate
            ? this.calculateDayDifference(startDate, endDate)
            : null,
        },
      });
      counters.cycles += 1;
    }
  }

  private async importFlowEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'flow',
        'flows',
        'flowEntries',
        'bleeding',
        'bleedingEntries',
      ]),
      this.filterRecordsByType(allRecords, ['flow', 'bleeding', 'periodFlow']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const intensity = this.getFlowIntensity(record);

      if (!date || !intensity) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.flowEntry.create({
        data: { userId, date, intensity },
      });
      counters.flowEntries += 1;
    }
  }

  private async importSymptomEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'symptoms',
        'symptomEntries',
        'healthSymptoms',
      ]),
      this.filterRecordsByType(allRecords, ['symptom', 'symptoms']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const name = this.getString(record, [
        'symptomName',
        'symptom',
        'name',
        'title',
        'value',
      ]);

      if (!date || !name) {
        counters.skipped += 1;
        continue;
      }

      const symptom = await this.prisma.symptom.upsert({
        where: { name },
        update: {},
        create: { name },
      });

      await this.prisma.symptomEntry.create({
        data: {
          userId,
          symptomId: symptom.id,
          date,
          intensity: this.getIntegerInRange(
            record,
            ['intensity', 'level'],
            1,
            5,
          ),
        },
      });
      counters.symptomEntries += 1;
    }
  }

  private async importMoodEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, ['moods', 'moodEntries']),
      this.filterRecordsByType(allRecords, ['mood', 'emotion']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const mood = this.getMoodType(record);

      if (!date || !mood) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.moodEntry.create({
        data: {
          userId,
          date,
          mood,
          note: this.getString(record, ['note', 'comment', 'description']),
        },
      });
      counters.moodEntries += 1;
    }
  }

  private async importNotes(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'notes',
        'noteEntries',
        'diary',
      ]),
      this.filterRecordsByType(allRecords, ['note', 'diary']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const content = this.getString(record, [
        'content',
        'note',
        'text',
        'comment',
        'description',
      ]);

      if (!date || !content) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.note.create({
        data: { userId, date, content },
      });
      counters.notes += 1;
    }
  }

  private async importTemperatureEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'temperature',
        'temperatures',
        'temperatureEntries',
        'basalTemperature',
      ]),
      this.filterRecordsByType(allRecords, ['temperature', 'basalTemperature']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const temperature = this.getNumber(record, [
        'temperature',
        'basalTemperature',
        'value',
      ]);

      if (!date || temperature === null) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.temperatureEntry.create({
        data: { userId, date, temperature },
      });
      counters.temperatureEntries += 1;
    }
  }

  private async importWeightEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'weight',
        'weights',
        'weightEntries',
      ]),
      this.filterRecordsByType(allRecords, ['weight']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const weight = this.getNumber(record, ['weight', 'value']);

      if (!date || weight === null) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.weightEntry.create({
        data: { userId, date, weight },
      });
      counters.weightEntries += 1;
    }
  }

  private async importWaterEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, ['water', 'waterEntries']),
      this.filterRecordsByType(allRecords, ['water']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const amount = this.getIntegerInRange(
        record,
        ['amount', 'milliliters', 'ml', 'value'],
        1,
        5000,
      );

      if (!date || amount === undefined) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.waterEntry.create({
        data: { userId, date, amount },
      });
      counters.waterEntries += 1;
    }
  }

  private async importActivityEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'activities',
        'activityEntries',
        'exercise',
      ]),
      this.filterRecordsByType(allRecords, ['activity', 'exercise', 'workout']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const type = this.getActivityType(record);
      const intensity = this.getActivityIntensity(record);
      const duration = this.getIntegerInRange(
        record,
        ['duration', 'durationMinutes', 'minutes'],
        1,
        1440,
      );

      if (!date || !type || !intensity || duration === undefined) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.activityEntry.create({
        data: { userId, date, type, intensity, duration },
      });
      counters.activityEntries += 1;
    }
  }

  private async importSleepEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, ['sleep', 'sleepEntries']),
      this.filterRecordsByType(allRecords, ['sleep']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const hours = this.getNumber(record, ['hours', 'sleepHours', 'value']);
      const quality = this.getSleepQuality(record);

      if (!date || hours === null || !quality) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.sleepEntry.create({
        data: { userId, date, hours, quality },
      });
      counters.sleepEntries += 1;
    }
  }

  private async importIntercourseEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'intercourse',
        'intercourseEntries',
        'sex',
        'sexualActivity',
      ]),
      this.filterRecordsByType(allRecords, [
        'intercourse',
        'sex',
        'sexualActivity',
      ]),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const protectedValue = this.getBoolean(record, [
        'protected',
        'isProtected',
        'contraception',
      ]);

      if (!date || protectedValue === null) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.intercourseEntry.create({
        data: { userId, date, protected: protectedValue },
      });
      counters.intercourseEntries += 1;
    }
  }

  private async importMedicationEntries(
    userId: string,
    payload: unknown,
    allRecords: JsonRecord[],
    counters: ImportCounters,
  ) {
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, [
        'medications',
        'medicationEntries',
        'pills',
      ]),
      this.filterRecordsByType(allRecords, ['medication', 'pill']),
    );

    for (const record of records) {
      const date = this.getDate(record, [
        'date',
        'day',
        'loggedAt',
        'createdAt',
      ]);
      const name = this.getString(record, [
        'name',
        'medication',
        'pill',
        'title',
      ]);

      if (!date || !name) {
        counters.skipped += 1;
        continue;
      }

      await this.prisma.medicationEntry.create({
        data: {
          userId,
          date,
          name,
          dose: this.getString(record, ['dose', 'dosage', 'amount']),
        },
      });
      counters.medicationEntries += 1;
    }
  }

  private createCounters(): ImportCounters {
    return {
      cycles: 0,
      flowEntries: 0,
      symptomEntries: 0,
      moodEntries: 0,
      notes: 0,
      temperatureEntries: 0,
      weightEntries: 0,
      waterEntries: 0,
      activityEntries: 0,
      sleepEntries: 0,
      intercourseEntries: 0,
      medicationEntries: 0,
      skipped: 0,
    };
  }

  private collectRecords(value: unknown): JsonRecord[] {
    const records: JsonRecord[] = [];

    if (Array.isArray(value)) {
      for (const item of value) {
        records.push(...this.collectRecords(item));
      }
      return records;
    }

    if (!this.isRecord(value)) {
      return records;
    }

    records.push(value);

    for (const child of Object.values(value)) {
      if (Array.isArray(child) || this.isRecord(child)) {
        records.push(...this.collectRecords(child));
      }
    }

    return records;
  }

  private collectRecordsByContainer(value: unknown, keys: string[]) {
    const records: JsonRecord[] = [];

    if (Array.isArray(value)) {
      for (const item of value) {
        records.push(...this.collectRecordsByContainer(item, keys));
      }
      return records;
    }

    if (!this.isRecord(value)) {
      return records;
    }

    for (const [key, child] of Object.entries(value)) {
      if (this.matchesKey(key, keys) && Array.isArray(child)) {
        records.push(
          ...child.filter((item): item is JsonRecord => this.isRecord(item)),
        );
      }

      if (Array.isArray(child) || this.isRecord(child)) {
        records.push(...this.collectRecordsByContainer(child, keys));
      }
    }

    return records;
  }

  private filterRecordsByType(records: JsonRecord[], types: string[]) {
    return records.filter((record) => {
      const value = this.getString(record, [
        'type',
        'kind',
        'category',
        'eventType',
      ]);

      if (!value) {
        return false;
      }

      return types.some((type) =>
        this.normalize(value).includes(this.normalize(type)),
      );
    });
  }

  private mergeRecords(first: JsonRecord[], second: JsonRecord[]) {
    return [...new Set([...first, ...second])];
  }

  private getDate(record: JsonRecord, keys: string[]) {
    const value = this.getValue(record, keys);

    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  }

  private getEndDateFromDuration(record: JsonRecord, startDate: Date) {
    const duration = this.getIntegerInRange(
      record,
      ['duration', 'length', 'periodLength', 'days'],
      1,
      30,
    );

    if (duration === undefined) {
      return null;
    }

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + duration);
    return endDate;
  }

  private getString(record: JsonRecord, keys: string[]) {
    const value = this.getValue(record, keys);

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return null;
  }

  private getNumber(record: JsonRecord, keys: string[]) {
    const value = this.getValue(record, keys);

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private getIntegerInRange(
    record: JsonRecord,
    keys: string[],
    min: number,
    max: number,
  ) {
    const value = this.getNumber(record, keys);

    if (value === null) {
      return undefined;
    }

    const integer = Math.round(value);

    if (integer < min || integer > max) {
      return undefined;
    }

    return integer;
  }

  private getBoolean(record: JsonRecord, keys: string[]) {
    const value = this.getValue(record, keys);

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = this.normalize(value);

      if (['true', 'yes', 'sim', 'protected', 'condom'].includes(normalized)) {
        return true;
      }

      if (['false', 'no', 'nao', 'unprotected', 'none'].includes(normalized)) {
        return false;
      }
    }

    return null;
  }

  private getFlowIntensity(record: JsonRecord) {
    const value = this.getString(record, [
      'intensity',
      'flow',
      'amount',
      'value',
    ]);

    if (!value) {
      return null;
    }

    const normalized = this.normalize(value);
    const map: Record<string, FlowIntensity> = {
      spotting: FlowIntensity.SPOTTING,
      verylight: FlowIntensity.SPOTTING,
      light: FlowIntensity.LIGHT,
      low: FlowIntensity.LIGHT,
      medium: FlowIntensity.MEDIUM,
      normal: FlowIntensity.MEDIUM,
      heavy: FlowIntensity.HEAVY,
      high: FlowIntensity.HEAVY,
      veryheavy: FlowIntensity.VERY_HEAVY,
    };

    return map[normalized] ?? null;
  }

  private getMoodType(record: JsonRecord) {
    const value = this.getString(record, ['mood', 'emotion', 'value', 'name']);

    if (!value) {
      return null;
    }

    const normalized = this.normalize(value);
    const map: Record<string, MoodType> = {
      happy: MoodType.HAPPY,
      sad: MoodType.SAD,
      anxious: MoodType.ANXIOUS,
      anxiety: MoodType.ANXIOUS,
      irritable: MoodType.IRRITABLE,
      angry: MoodType.IRRITABLE,
      calm: MoodType.CALM,
      energetic: MoodType.ENERGETIC,
      tired: MoodType.TIRED,
      sensitive: MoodType.SENSITIVE,
    };

    return map[normalized] ?? null;
  }

  private getActivityType(record: JsonRecord) {
    const value = this.getString(record, [
      'activityType',
      'type',
      'name',
      'value',
    ]);

    if (!value) {
      return null;
    }

    const normalized = this.normalize(value);
    const map: Record<string, ActivityType> = {
      walking: ActivityType.WALKING,
      walk: ActivityType.WALKING,
      running: ActivityType.RUNNING,
      run: ActivityType.RUNNING,
      cycling: ActivityType.CYCLING,
      bike: ActivityType.CYCLING,
      swimming: ActivityType.SWIMMING,
      yoga: ActivityType.YOGA,
      gym: ActivityType.GYM,
      workout: ActivityType.GYM,
      dancing: ActivityType.DANCING,
      dance: ActivityType.DANCING,
      other: ActivityType.OTHER,
    };

    return map[normalized] ?? ActivityType.OTHER;
  }

  private getActivityIntensity(record: JsonRecord) {
    const value = this.getString(record, ['intensity', 'level', 'effort']);

    if (!value) {
      return ActivityIntensity.MEDIUM;
    }

    const normalized = this.normalize(value);
    const map: Record<string, ActivityIntensity> = {
      low: ActivityIntensity.LOW,
      light: ActivityIntensity.LOW,
      medium: ActivityIntensity.MEDIUM,
      normal: ActivityIntensity.MEDIUM,
      high: ActivityIntensity.HIGH,
      heavy: ActivityIntensity.HIGH,
    };

    return map[normalized] ?? ActivityIntensity.MEDIUM;
  }

  private getSleepQuality(record: JsonRecord) {
    const value = this.getString(record, ['quality', 'sleepQuality', 'level']);

    if (!value) {
      return SleepQuality.GOOD;
    }

    const normalized = this.normalize(value);
    const map: Record<string, SleepQuality> = {
      poor: SleepQuality.POOR,
      bad: SleepQuality.POOR,
      fair: SleepQuality.FAIR,
      ok: SleepQuality.FAIR,
      good: SleepQuality.GOOD,
      excellent: SleepQuality.EXCELLENT,
      great: SleepQuality.EXCELLENT,
    };

    return map[normalized] ?? SleepQuality.GOOD;
  }

  private getValue(record: JsonRecord, keys: string[]) {
    const normalizedKeys = keys.map((key) => this.normalize(key));

    for (const [key, value] of Object.entries(record)) {
      if (normalizedKeys.includes(this.normalize(key))) {
        return value;
      }
    }

    return undefined;
  }

  private matchesKey(key: string, keys: string[]) {
    const normalizedKey = this.normalize(key);
    return keys.some(
      (candidate) => normalizedKey === this.normalize(candidate),
    );
  }

  private calculateDayDifference(startDate: Date, endDate: Date) {
    return Math.round((endDate.getTime() - startDate.getTime()) / DAY_IN_MS);
  }

  private normalize(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
