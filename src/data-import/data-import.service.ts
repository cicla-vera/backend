import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ActivityIntensity,
  ActivityType,
  FlowIntensity,
  MoodType,
  SleepQuality,
} from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
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

  async importClue(userId: string, payload: unknown) {
    const measurements = this.getClueMeasurements(payload);
    const counters = this.createCounters();
    const periodDates: Date[] = [];

    for (const measurement of measurements) {
      const type = this.getString(measurement, ['type']);
      const date = this.getDate(measurement, ['date']);

      if (!type || !date) {
        counters.skipped += 1;
        continue;
      }

      const normalizedType = this.normalize(type);

      if (normalizedType === 'period') {
        await this.prisma.flowEntry.create({
          data: {
            userId,
            date,
            intensity: this.getClueFlowIntensity(measurement),
          },
        });
        counters.flowEntries += 1;
        periodDates.push(date);
        continue;
      }

      if (normalizedType.includes('temperature')) {
        const temperature = this.getClueNumericValue(measurement);

        if (temperature === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.temperatureEntry.create({
          data: { userId, date, temperature },
        });
        counters.temperatureEntries += 1;
        continue;
      }

      if (normalizedType.includes('weight')) {
        const weight = this.getClueNumericValue(measurement);

        if (weight === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.weightEntry.create({
          data: { userId, date, weight },
        });
        counters.weightEntries += 1;
        continue;
      }

      if (normalizedType.includes('sleep')) {
        const hours = this.getClueNumericValue(measurement);

        if (hours === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.sleepEntry.create({
          data: { userId, date, hours, quality: SleepQuality.GOOD },
        });
        counters.sleepEntries += 1;
        continue;
      }

      if (normalizedType.includes('sex')) {
        const option = this.getClueOption(measurement);
        await this.prisma.intercourseEntry.create({
          data: {
            userId,
            date,
            protected: option
              ? this.normalize(option).includes('protected')
              : false,
          },
        });
        counters.intercourseEntries += 1;
        continue;
      }

      if (normalizedType.includes('pill')) {
        await this.prisma.medicationEntry.create({
          data: {
            userId,
            date,
            name: this.getClueOption(measurement) ?? 'Pill',
          },
        });
        counters.medicationEntries += 1;
        continue;
      }

      const mood = this.getMoodType({
        mood: this.getClueOption(measurement) ?? type,
      });
      if (normalizedType.includes('mood') && mood) {
        await this.prisma.moodEntry.create({
          data: { userId, date, mood },
        });
        counters.moodEntries += 1;
        continue;
      }

      const symptomName = this.getClueSymptomName(measurement);
      if (symptomName) {
        await this.createSymptomEntry(userId, date, symptomName);
        counters.symptomEntries += 1;
        continue;
      }

      counters.skipped += 1;
    }

    await this.importCyclesFromPeriodDates(userId, periodDates, counters);

    return {
      source: 'clue',
      imported: counters,
      processedRecords: measurements.length,
      generatedAt: new Date().toISOString(),
    };
  }

  async importPeriodCalendar(userId: string, payload: unknown) {
    const text = await this.getPeriodCalendarText(payload);
    const referenceYear = this.getPeriodCalendarReferenceYear(payload);
    const periodRows = this.getPeriodCalendarRows(text, referenceYear);
    const counters = this.createCounters();

    for (const row of periodRows) {
      const endDate = new Date(row.startDate);
      endDate.setUTCDate(row.startDate.getUTCDate() + row.periodLength);

      await this.prisma.cycleLog.create({
        data: {
          userId,
          startDate: row.startDate,
          endDate,
          duration: row.periodLength,
        },
      });
      counters.cycles += 1;

      for (let index = 0; index < row.periodLength; index += 1) {
        const date = new Date(row.startDate);
        date.setUTCDate(row.startDate.getUTCDate() + index);

        await this.prisma.flowEntry.create({
          data: { userId, date, intensity: FlowIntensity.MEDIUM },
        });
        counters.flowEntries += 1;
      }
    }

    return {
      source: 'period-calendar',
      imported: counters,
      processedRecords: periodRows.length,
      generatedAt: new Date().toISOString(),
    };
  }

  async importAppleHealth(userId: string, payload: unknown) {
    const xml = this.getXmlPayload(
      payload,
      'Apple Health import payload must be XML text or an object with an xml field.',
    );
    const records = this.getAppleHealthRecords(xml);
    const counters = this.createCounters();
    const periodDates: Date[] = [];

    for (const record of records) {
      const type = this.getString(record, ['type']);

      if (!type) {
        continue;
      }

      const normalizedType = this.normalize(type);

      if (normalizedType.includes('menstrualflow')) {
        const date = this.getDate(record, ['startDate', 'date']);
        const intensity = this.getAppleFlowIntensity(record);

        if (!date || !intensity) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.flowEntry.create({
          data: { userId, date, intensity },
        });
        counters.flowEntries += 1;
        periodDates.push(date);
        continue;
      }

      if (
        normalizedType.includes('intermenstrualbleeding') ||
        normalizedType.includes('spotting')
      ) {
        const date = this.getDate(record, ['startDate', 'date']);

        if (!date) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.flowEntry.create({
          data: { userId, date, intensity: FlowIntensity.SPOTTING },
        });
        counters.flowEntries += 1;
        continue;
      }

      if (
        normalizedType.includes('basalbodytemperature') ||
        normalizedType.includes('bodytemperature')
      ) {
        const date = this.getDate(record, ['startDate', 'date']);
        const temperature = this.getAppleTemperature(record);

        if (!date || temperature === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.temperatureEntry.create({
          data: { userId, date, temperature },
        });
        counters.temperatureEntries += 1;
        continue;
      }

      if (normalizedType.includes('bodymass')) {
        const date = this.getDate(record, ['startDate', 'date']);
        const weight = this.getAppleWeight(record);

        if (!date || weight === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.weightEntry.create({
          data: { userId, date, weight },
        });
        counters.weightEntries += 1;
        continue;
      }

      if (normalizedType.includes('dietarywater')) {
        const date = this.getDate(record, ['startDate', 'date']);
        const amount = this.getAppleWaterAmount(record);

        if (!date || amount === undefined) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.waterEntry.create({
          data: { userId, date, amount },
        });
        counters.waterEntries += 1;
        continue;
      }

      if (normalizedType.includes('sleepanalysis')) {
        const startDate = this.getDate(record, ['startDate']);
        const endDate = this.getDate(record, ['endDate']);
        const hours = this.getHoursBetween(startDate, endDate);

        if (!startDate || hours === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.sleepEntry.create({
          data: {
            userId,
            date: startDate,
            hours,
            quality: SleepQuality.GOOD,
          },
        });
        counters.sleepEntries += 1;
        continue;
      }

      if (normalizedType.includes('sexualactivity')) {
        const date = this.getDate(record, ['startDate', 'date']);

        if (!date) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.intercourseEntry.create({
          data: {
            userId,
            date,
            protected: this.getAppleProtectionUsed(record),
          },
        });
        counters.intercourseEntries += 1;
        continue;
      }

      const symptomName = this.getAppleSymptomName(type, record);
      if (symptomName) {
        const date = this.getDate(record, ['startDate', 'date']);

        if (!date) {
          counters.skipped += 1;
          continue;
        }

        await this.createSymptomEntry(userId, date, symptomName);
        counters.symptomEntries += 1;
      }
    }

    await this.importCyclesFromPeriodDates(userId, periodDates, counters);

    return {
      source: 'apple-health',
      imported: counters,
      processedRecords: records.length,
      generatedAt: new Date().toISOString(),
    };
  }

  async importHealthConnect(userId: string, payload: unknown) {
    if (!this.isRecord(payload) && !Array.isArray(payload)) {
      throw new BadRequestException(
        'Health Connect import payload must be a JSON object.',
      );
    }

    const counters = this.createCounters();
    const records = this.mergeRecords(
      this.collectRecordsByContainer(payload, ['records', 'data', 'entries']),
      this.collectRecords(payload).filter(
        (record) => this.getHealthConnectRecordType(record) !== null,
      ),
    );
    const periodDates: Date[] = [];
    let explicitPeriodRecords = 0;

    for (const record of records) {
      const recordType = this.getHealthConnectRecordType(record);

      if (!recordType) {
        continue;
      }

      if (recordType.includes('menstruationperiodrecord')) {
        const startDate = this.getDate(record, ['startTime', 'startDate']);
        const endDate = this.getDate(record, ['endTime', 'endDate']);

        if (!startDate || !endDate) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.cycleLog.create({
          data: {
            userId,
            startDate,
            endDate,
            duration: this.calculateDayDifference(startDate, endDate),
          },
        });
        counters.cycles += 1;
        explicitPeriodRecords += 1;
        continue;
      }

      if (recordType.includes('menstruationflowrecord')) {
        const date = this.getDate(record, ['time', 'startTime', 'date']);
        const intensity = this.getHealthConnectFlowIntensity(record);

        if (!date || !intensity) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.flowEntry.create({
          data: { userId, date, intensity },
        });
        counters.flowEntries += 1;
        periodDates.push(date);
        continue;
      }

      if (recordType.includes('intermenstrualbleedingrecord')) {
        const date = this.getDate(record, ['time', 'startTime', 'date']);

        if (!date) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.flowEntry.create({
          data: { userId, date, intensity: FlowIntensity.SPOTTING },
        });
        counters.flowEntries += 1;
        continue;
      }

      if (
        recordType.includes('basalbodytemperaturerecord') ||
        recordType.includes('bodytemperaturerecord')
      ) {
        const date = this.getDate(record, ['time', 'startTime', 'date']);
        const temperature = this.getHealthConnectTemperature(record);

        if (!date || temperature === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.temperatureEntry.create({
          data: { userId, date, temperature },
        });
        counters.temperatureEntries += 1;
        continue;
      }

      if (recordType.includes('weightrecord')) {
        const date = this.getDate(record, ['time', 'startTime', 'date']);
        const weight = this.getHealthConnectMass(record);

        if (!date || weight === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.weightEntry.create({
          data: { userId, date, weight },
        });
        counters.weightEntries += 1;
        continue;
      }

      if (recordType.includes('hydrationrecord')) {
        const date = this.getDate(record, ['time', 'startTime', 'date']);
        const amount = this.getHealthConnectVolume(record);

        if (!date || amount === undefined) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.waterEntry.create({
          data: { userId, date, amount },
        });
        counters.waterEntries += 1;
        continue;
      }

      if (recordType.includes('sleepsessionrecord')) {
        const startDate = this.getDate(record, ['startTime', 'startDate']);
        const endDate = this.getDate(record, ['endTime', 'endDate']);
        const hours = this.getHoursBetween(startDate, endDate);

        if (!startDate || hours === null) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.sleepEntry.create({
          data: {
            userId,
            date: startDate,
            hours,
            quality: SleepQuality.GOOD,
          },
        });
        counters.sleepEntries += 1;
        continue;
      }

      if (recordType.includes('exercisesessionrecord')) {
        const startDate = this.getDate(record, ['startTime', 'startDate']);
        const endDate = this.getDate(record, ['endTime', 'endDate']);
        const duration =
          this.getIntegerInRange(
            record,
            ['duration', 'durationMinutes'],
            1,
            1440,
          ) ?? this.getMinutesBetween(startDate, endDate);
        const type = this.getActivityType(record);
        const intensity = this.getActivityIntensity(record);

        if (!startDate || duration === undefined || !type || !intensity) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.activityEntry.create({
          data: { userId, date: startDate, type, intensity, duration },
        });
        counters.activityEntries += 1;
        continue;
      }

      if (recordType.includes('sexualactivityrecord')) {
        const date = this.getDate(record, ['time', 'startTime', 'date']);
        const protectedValue =
          this.getBoolean(record, ['protected', 'isProtected']) ?? false;

        if (!date) {
          counters.skipped += 1;
          continue;
        }

        await this.prisma.intercourseEntry.create({
          data: { userId, date, protected: protectedValue },
        });
        counters.intercourseEntries += 1;
      }
    }

    if (explicitPeriodRecords === 0) {
      await this.importCyclesFromPeriodDates(userId, periodDates, counters);
    }

    return {
      source: 'health-connect',
      imported: counters,
      processedRecords: records.length,
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

  private getClueMeasurements(payload: unknown) {
    if (Array.isArray(payload)) {
      return payload.filter((item): item is JsonRecord => this.isRecord(item));
    }

    if (!this.isRecord(payload)) {
      throw new BadRequestException(
        'Clue import payload must be measurements JSON.',
      );
    }

    const measurements = this.getValue(payload, [
      'measurements',
      'measurementsJson',
      'data',
    ]);

    if (Array.isArray(measurements)) {
      return measurements.filter((item): item is JsonRecord =>
        this.isRecord(item),
      );
    }

    if (this.getString(payload, ['type']) && this.getDate(payload, ['date'])) {
      return [payload];
    }

    throw new BadRequestException(
      'Clue import payload must contain a measurements array.',
    );
  }

  private getClueFlowIntensity(measurement: JsonRecord) {
    const option = this.getClueOption(measurement);

    if (!option) {
      return FlowIntensity.MEDIUM;
    }

    const normalized = this.normalize(option);
    const map: Record<string, FlowIntensity> = {
      spotting: FlowIntensity.SPOTTING,
      light: FlowIntensity.LIGHT,
      medium: FlowIntensity.MEDIUM,
      heavy: FlowIntensity.HEAVY,
      veryheavy: FlowIntensity.VERY_HEAVY,
    };

    return map[normalized] ?? FlowIntensity.MEDIUM;
  }

  private getClueNumericValue(measurement: JsonRecord) {
    const directValue = this.getNumber(measurement, ['value']);

    if (directValue !== null) {
      return directValue;
    }

    const value = this.getValue(measurement, ['value']);

    if (!this.isRecord(value)) {
      return null;
    }

    return this.getNumber(value, ['amount', 'number', 'value']);
  }

  private getClueOption(measurement: JsonRecord) {
    const value = this.getValue(measurement, ['value']);

    if (!this.isRecord(value)) {
      return this.getString(measurement, ['value', 'option', 'name']);
    }

    return this.getString(value, ['option', 'name', 'value']);
  }

  private getClueSymptomName(measurement: JsonRecord) {
    const type = this.getString(measurement, ['type']);

    if (!type) {
      return null;
    }

    const option = this.getClueOption(measurement);
    const normalizedType = this.normalize(type);

    if (
      ['period', 'mood', 'temperature', 'weight', 'sleep', 'sex', 'pill'].some(
        (ignoredType) => normalizedType.includes(ignoredType),
      )
    ) {
      return null;
    }

    return option ? `${type}: ${option}` : type;
  }

  private async getPeriodCalendarText(payload: unknown) {
    if (typeof payload === 'string' && payload.trim().length > 0) {
      return payload;
    }

    if (!this.isRecord(payload)) {
      throw new BadRequestException(
        'Period Calendar import payload must include text or pdfBase64.',
      );
    }

    const text = this.getString(payload, ['text', 'content']);
    if (text) {
      return text;
    }

    const pdfBase64 = this.getString(payload, ['pdfBase64', 'base64']);
    if (!pdfBase64) {
      throw new BadRequestException(
        'Period Calendar import payload must include text or pdfBase64.',
      );
    }

    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({
      data: Buffer.from(pdfBase64, 'base64'),
    });

    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  private getPeriodCalendarReferenceYear(payload: unknown) {
    if (!this.isRecord(payload)) {
      return new Date().getUTCFullYear();
    }

    return (
      this.getIntegerInRange(payload, ['year', 'referenceYear'], 1900, 2200) ??
      new Date().getUTCFullYear()
    );
  }

  private getPeriodCalendarRows(text: string, referenceYear: number) {
    const rows: { startDate: Date; periodLength: number }[] = [];
    const historyRowRegex =
      /(\d{2}\/\d{2})\s*-\s*(?:Hoje|\d{2}\/\d{2})\s+(\d+)\s*Dias/gi;

    for (const match of text.matchAll(historyRowRegex)) {
      const startDate = this.parseDayMonth(match[1], referenceYear);
      const periodLength = Number(match[2]);

      if (startDate && Number.isFinite(periodLength)) {
        rows.push({ startDate, periodLength });
      }
    }

    if (rows.length > 0) {
      return rows;
    }

    const lastPeriodMatch = /ÚLTIMA MENSTRUAÇÃO\s+(\d{2}\/\d{2})/i.exec(text);
    const periodLengthMatch =
      /DURAÇÃO MÉDIA DA MENSTRUAÇÃO\s+(\d+)\s*dias/i.exec(text);
    const startDate = lastPeriodMatch
      ? this.parseDayMonth(lastPeriodMatch[1], referenceYear)
      : null;
    const periodLength = periodLengthMatch ? Number(periodLengthMatch[1]) : 5;

    if (!startDate || !Number.isFinite(periodLength)) {
      throw new BadRequestException(
        'Period Calendar report does not contain recognizable cycle rows.',
      );
    }

    return [{ startDate, periodLength }];
  }

  private parseDayMonth(value: string, referenceYear: number) {
    const match = /^(\d{2})\/(\d{2})$/.exec(value);

    if (!match) {
      return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const date = new Date(Date.UTC(referenceYear, month - 1, day));
    const today = new Date();

    if (date.getTime() - today.getTime() > 45 * DAY_IN_MS) {
      date.setUTCFullYear(referenceYear - 1);
    }

    return date;
  }

  private async importCyclesFromPeriodDates(
    userId: string,
    dates: Date[],
    counters: ImportCounters,
  ) {
    const uniqueDates = [...new Set(dates.map((date) => this.formatDate(date)))]
      .map((date) => new Date(`${date}T00:00:00.000Z`))
      .sort((a, b) => a.getTime() - b.getTime());

    if (uniqueDates.length === 0) {
      return;
    }

    const groups: Date[][] = [];
    for (const date of uniqueDates) {
      const currentGroup = groups[groups.length - 1];
      const previousDate = currentGroup?.[currentGroup.length - 1];

      if (
        !currentGroup ||
        !previousDate ||
        this.calculateDayDifference(previousDate, date) > 1
      ) {
        groups.push([date]);
        continue;
      }

      currentGroup.push(date);
    }

    for (const group of groups) {
      const startDate = group[0];
      const lastDate = group[group.length - 1];
      const endDate = new Date(lastDate);
      endDate.setUTCDate(lastDate.getUTCDate() + 1);

      await this.prisma.cycleLog.create({
        data: {
          userId,
          startDate,
          endDate,
          duration: this.calculateDayDifference(startDate, endDate),
        },
      });
      counters.cycles += 1;
    }
  }

  private async createSymptomEntry(
    userId: string,
    date: Date,
    symptomName: string,
  ) {
    const symptom = await this.prisma.symptom.upsert({
      where: { name: symptomName },
      update: {},
      create: { name: symptomName },
    });

    await this.prisma.symptomEntry.create({
      data: {
        userId,
        date,
        symptomId: symptom.id,
      },
    });
  }

  private getXmlPayload(payload: unknown, errorMessage: string) {
    if (typeof payload === 'string' && payload.trim().length > 0) {
      return payload;
    }

    if (this.isRecord(payload)) {
      const xml = this.getString(payload, [
        'xml',
        'exportXml',
        'data',
        'content',
      ]);

      if (xml) {
        return xml;
      }
    }

    throw new BadRequestException(errorMessage);
  }

  private getAppleHealthRecords(xml: string) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      parseAttributeValue: false,
      parseTagValue: false,
    });

    const parsed = parser.parse(xml) as unknown;
    const healthData = this.isRecord(parsed) ? parsed.HealthData : undefined;
    const records = this.isRecord(healthData)
      ? this.toRecordArray(healthData.Record)
      : [];

    if (records.length === 0) {
      throw new BadRequestException(
        'Apple Health XML does not contain HealthData Record entries.',
      );
    }

    return records;
  }

  private getAppleFlowIntensity(record: JsonRecord) {
    const value = this.getString(record, ['value']);

    if (!value) {
      return null;
    }

    const normalized = this.normalize(value);
    const map: Record<string, FlowIntensity | null> = {
      '1': FlowIntensity.MEDIUM,
      '2': FlowIntensity.LIGHT,
      '3': FlowIntensity.MEDIUM,
      '4': FlowIntensity.HEAVY,
      '5': null,
      unspecified: FlowIntensity.MEDIUM,
      light: FlowIntensity.LIGHT,
      medium: FlowIntensity.MEDIUM,
      heavy: FlowIntensity.HEAVY,
      none: null,
    };

    if (map[normalized] !== undefined) {
      return map[normalized];
    }

    if (normalized.includes('light')) {
      return FlowIntensity.LIGHT;
    }

    if (normalized.includes('medium')) {
      return FlowIntensity.MEDIUM;
    }

    if (normalized.includes('heavy')) {
      return FlowIntensity.HEAVY;
    }

    return null;
  }

  private getAppleTemperature(record: JsonRecord) {
    const value = this.getNumber(record, ['value', 'temperature']);

    if (value === null) {
      return null;
    }

    const unit = this.getString(record, ['unit']);

    if (unit && this.normalize(unit).includes('degf')) {
      return this.roundToOneDecimal(((value - 32) * 5) / 9);
    }

    return value;
  }

  private getAppleWeight(record: JsonRecord) {
    const value = this.getNumber(record, ['value', 'weight']);

    if (value === null) {
      return null;
    }

    const unit = this.getString(record, ['unit']);
    const normalizedUnit = unit ? this.normalize(unit) : '';

    if (['lb', 'lbs', 'pound', 'pounds'].includes(normalizedUnit)) {
      return this.roundToOneDecimal(value * 0.45359237);
    }

    return value;
  }

  private getAppleWaterAmount(record: JsonRecord) {
    const value = this.getNumber(record, ['value', 'amount']);

    if (value === null) {
      return undefined;
    }

    const unit = this.getString(record, ['unit']);
    const normalizedUnit = unit ? this.normalize(unit) : '';
    const amount =
      normalizedUnit === 'l' || normalizedUnit === 'liter'
        ? value * 1000
        : value;

    return Math.round(amount);
  }

  private getAppleProtectionUsed(record: JsonRecord) {
    const metadataValue = this.getMetadataValue(
      record,
      'HKSexualActivityProtectionUsed',
    );

    if (metadataValue === null) {
      return false;
    }

    return ['1', 'true', 'yes'].includes(this.normalize(metadataValue));
  }

  private getAppleSymptomName(type: string, record: JsonRecord) {
    const normalizedType = this.normalize(type);
    const value = this.getString(record, ['value']);

    if (normalizedType.includes('cervicalmucusquality')) {
      return `Cervical mucus${value ? `: ${value}` : ''}`;
    }

    if (normalizedType.includes('ovulationtestresult')) {
      return `Ovulation test${value ? `: ${value}` : ''}`;
    }

    if (normalizedType.includes('progesteronetestresult')) {
      return `Progesterone test${value ? `: ${value}` : ''}`;
    }

    if (normalizedType.includes('pregnancytestresult')) {
      return `Pregnancy test${value ? `: ${value}` : ''}`;
    }

    return null;
  }

  private getMetadataValue(record: JsonRecord, key: string) {
    const metadataEntries = this.toRecordArray(record.MetadataEntry);

    for (const metadata of metadataEntries) {
      const metadataKey = this.getString(metadata, ['key']);

      if (metadataKey && this.normalize(metadataKey) === this.normalize(key)) {
        return this.getString(metadata, ['value']);
      }
    }

    return null;
  }

  private getHealthConnectRecordType(record: JsonRecord) {
    const value = this.getString(record, [
      'recordType',
      'dataType',
      'type',
      'name',
      'kind',
    ]);

    return value ? this.normalize(value) : null;
  }

  private getHealthConnectFlowIntensity(record: JsonRecord) {
    const value = this.getString(record, [
      'flow',
      'menstruationFlowType',
      'value',
    ]);

    if (!value) {
      return null;
    }

    const normalized = this.normalize(value);
    const map: Record<string, FlowIntensity | null> = {
      '0': null,
      '1': FlowIntensity.LIGHT,
      '2': FlowIntensity.MEDIUM,
      '3': FlowIntensity.HEAVY,
      '4': FlowIntensity.VERY_HEAVY,
      unknown: null,
      light: FlowIntensity.LIGHT,
      medium: FlowIntensity.MEDIUM,
      heavy: FlowIntensity.HEAVY,
      veryheavy: FlowIntensity.VERY_HEAVY,
    };

    return map[normalized] ?? null;
  }

  private getHealthConnectTemperature(record: JsonRecord) {
    const celsius = this.getFirstNestedNumber(record, [
      ['temperature', 'inCelsius'],
      ['temperature', 'inCelsiusDegrees'],
      ['bodyTemperature', 'inCelsius'],
      ['value', 'inCelsius'],
    ]);

    if (celsius !== null) {
      return celsius;
    }

    const fahrenheit = this.getFirstNestedNumber(record, [
      ['temperature', 'inFahrenheit'],
      ['bodyTemperature', 'inFahrenheit'],
      ['value', 'inFahrenheit'],
    ]);

    if (fahrenheit !== null) {
      return this.roundToOneDecimal(((fahrenheit - 32) * 5) / 9);
    }

    return this.getNumber(record, ['temperature', 'value']);
  }

  private getHealthConnectMass(record: JsonRecord) {
    const kilograms = this.getFirstNestedNumber(record, [
      ['weight', 'inKilograms'],
      ['mass', 'inKilograms'],
      ['value', 'inKilograms'],
    ]);

    if (kilograms !== null) {
      return kilograms;
    }

    const grams = this.getFirstNestedNumber(record, [
      ['weight', 'inGrams'],
      ['mass', 'inGrams'],
      ['value', 'inGrams'],
    ]);

    if (grams !== null) {
      return this.roundToOneDecimal(grams / 1000);
    }

    const pounds = this.getFirstNestedNumber(record, [
      ['weight', 'inPounds'],
      ['mass', 'inPounds'],
      ['value', 'inPounds'],
    ]);

    if (pounds !== null) {
      return this.roundToOneDecimal(pounds * 0.45359237);
    }

    return this.getNumber(record, ['weight', 'mass', 'value']);
  }

  private getHealthConnectVolume(record: JsonRecord) {
    const milliliters = this.getFirstNestedNumber(record, [
      ['volume', 'inMilliliters'],
      ['amount', 'inMilliliters'],
      ['value', 'inMilliliters'],
    ]);

    if (milliliters !== null) {
      return Math.round(milliliters);
    }

    const liters = this.getFirstNestedNumber(record, [
      ['volume', 'inLiters'],
      ['amount', 'inLiters'],
      ['value', 'inLiters'],
    ]);

    if (liters !== null) {
      return Math.round(liters * 1000);
    }

    const value = this.getNumber(record, [
      'amount',
      'milliliters',
      'ml',
      'value',
    ]);
    return value === null ? undefined : Math.round(value);
  }

  private getHoursBetween(startDate: Date | null, endDate: Date | null) {
    if (!startDate || !endDate || endDate <= startDate) {
      return null;
    }

    return this.roundToOneDecimal(
      (endDate.getTime() - startDate.getTime()) / (60 * 60 * 1000),
    );
  }

  private getMinutesBetween(startDate: Date | null, endDate: Date | null) {
    if (!startDate || !endDate || endDate <= startDate) {
      return undefined;
    }

    return Math.round((endDate.getTime() - startDate.getTime()) / (60 * 1000));
  }

  private getFirstNestedNumber(record: JsonRecord, paths: string[][]) {
    for (const path of paths) {
      const value = this.getNestedValue(record, path);

      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === 'string') {
        const parsed = Number(value.replace(',', '.'));

        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return null;
  }

  private getNestedValue(record: JsonRecord, path: string[]) {
    let current: unknown = record;

    for (const key of path) {
      if (!this.isRecord(current)) {
        return undefined;
      }

      current = this.getValue(current, [key]);
    }

    return current;
  }

  private toRecordArray(value: unknown) {
    if (Array.isArray(value)) {
      return value.filter((item): item is JsonRecord => this.isRecord(item));
    }

    return this.isRecord(value) ? [value] : [];
  }

  private formatDate(date: Date) {
    return date.toISOString().split('T')[0];
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

  private roundToOneDecimal(value: number) {
    return Math.round(value * 10) / 10;
  }

  private normalize(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
