import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  ActivityIntensity,
  ActivityType,
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  FlowIntensity,
  LocationSampleSource,
  MoodType,
  PrismaClient,
  SafetyLocationType,
  SleepQuality,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const DEFAULT_DEMO_EMAIL = 'vera.demo@cicla.local';
const DEFAULT_DEMO_PASSWORD = 'VeraDemo123!';
const DEFAULT_DEMO_PHONE = '+5500000000000';
const FIXED_RISK_LOCATION_RADIUS_METERS = 150;

async function main() {
  const prisma = createPrismaClient();
  const email = process.env.DEMO_USER_EMAIL?.trim() || DEFAULT_DEMO_EMAIL;
  const password =
    process.env.DEMO_USER_PASSWORD?.trim() || DEFAULT_DEMO_PASSWORD;
  const emergencyPhone =
    process.env.DEMO_EMERGENCY_PHONE?.trim() || DEFAULT_DEMO_PHONE;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        password: passwordHash,
        emailVerifiedAt: new Date(),
      },
      update: {
        password: passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

    await resetDemoUserData(prisma, user.id);
    await seedProfile(prisma, user.id, emergencyPhone);
    await seedCycleHistory(prisma, user.id);
    await seedVeraSafetyHistory(prisma, user.id, emergencyPhone);

    console.log(
      JSON.stringify(
        {
          ok: true,
          email,
          password,
          emergencyPhone: maskPhone(emergencyPhone),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined.');
  }

  return new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });
}

async function resetDemoUserData(prisma: PrismaClient, userId: string) {
  await prisma.$transaction([
    prisma.evidenceAnalysis.deleteMany({ where: { userId } }),
    prisma.evidenceAuditEvent.deleteMany({ where: { userId } }),
    prisma.veraLocationSample.deleteMany({ where: { userId } }),
    prisma.alertLocationSample.deleteMany({ where: { userId } }),
    prisma.evidenceRecord.deleteMany({ where: { userId } }),
    prisma.alertEvent.deleteMany({ where: { userId } }),
    prisma.alertSession.deleteMany({ where: { userId } }),
    prisma.emergencyContact.deleteMany({ where: { userId } }),
    prisma.safetyLocation.deleteMany({ where: { userId } }),
    prisma.notificationDelivery.deleteMany({ where: { userId } }),
    prisma.notificationDevice.deleteMany({ where: { userId } }),
    prisma.notificationSettings.deleteMany({ where: { userId } }),
    prisma.medicationEntry.deleteMany({ where: { userId } }),
    prisma.intercourseEntry.deleteMany({ where: { userId } }),
    prisma.sleepEntry.deleteMany({ where: { userId } }),
    prisma.activityEntry.deleteMany({ where: { userId } }),
    prisma.waterEntry.deleteMany({ where: { userId } }),
    prisma.weightEntry.deleteMany({ where: { userId } }),
    prisma.temperatureEntry.deleteMany({ where: { userId } }),
    prisma.note.deleteMany({ where: { userId } }),
    prisma.flowEntry.deleteMany({ where: { userId } }),
    prisma.moodEntry.deleteMany({ where: { userId } }),
    prisma.symptomEntry.deleteMany({ where: { userId } }),
    prisma.cycleLog.deleteMany({ where: { userId } }),
  ]);
}

async function seedProfile(
  prisma: PrismaClient,
  userId: string,
  phone: string,
) {
  await prisma.profile.upsert({
    where: { userId },
    create: {
      userId,
      name: 'Ana Clara Martins',
      phone,
      phoneVerifiedAt: new Date(),
      birthDate: dateFromIso('1998-04-16'),
      avgCycleLength: 29,
      avgPeriodDuration: 5,
    },
    update: {
      name: 'Ana Clara Martins',
      phone,
      phoneVerifiedAt: new Date(),
      birthDate: dateFromIso('1998-04-16'),
      cpf: null,
      avgCycleLength: 29,
      avgPeriodDuration: 5,
    },
  });

  await prisma.safetyProfile.upsert({
    where: { userId },
    create: {
      userId,
      veraEnabled: true,
      consentAccepted: true,
      consentAcceptedAt: daysAgo(12, 9),
      biometricUnlockEnabled: true,
      discreetNotificationsEnabled: true,
      monitoringEnabled: true,
    },
    update: {
      veraEnabled: true,
      consentAccepted: true,
      consentAcceptedAt: daysAgo(12, 9),
      biometricUnlockEnabled: true,
      discreetNotificationsEnabled: true,
      monitoringEnabled: true,
    },
  });

  await prisma.notificationSettings.create({
    data: {
      userId,
      periodReminder: true,
      ovulationReminder: true,
      medicationReminder: true,
      waterReminder: true,
      reminderHour: 8,
    },
  });
}

async function seedCycleHistory(prisma: PrismaClient, userId: string) {
  await prisma.cycleLog.createMany({
    data: [
      {
        userId,
        startDate: daysAgo(58, 8),
        endDate: daysAgo(53, 22),
        duration: 5,
      },
      {
        userId,
        startDate: daysAgo(29, 8),
        endDate: daysAgo(24, 22),
        duration: 5,
      },
      {
        userId,
        startDate: daysAgo(1, 8),
        endDate: null,
        duration: null,
      },
    ],
  });

  await prisma.flowEntry.createMany({
    data: [
      { userId, intensity: FlowIntensity.MEDIUM, date: daysAgo(29, 10) },
      { userId, intensity: FlowIntensity.LIGHT, date: daysAgo(27, 10) },
      { userId, intensity: FlowIntensity.MEDIUM, date: daysAgo(1, 10) },
    ],
  });

  await prisma.moodEntry.createMany({
    data: [
      {
        userId,
        mood: MoodType.CALM,
        date: daysAgo(6, 21),
        note: 'Dormiu melhor.',
      },
      {
        userId,
        mood: MoodType.ANXIOUS,
        date: daysAgo(3, 20),
        note: 'Dia tenso.',
      },
      {
        userId,
        mood: MoodType.TIRED,
        date: daysAgo(1, 21),
        note: 'Cólicas leves.',
      },
    ],
  });

  const symptomNames = ['Cólicas', 'Dor de cabeça', 'Sensibilidade'];
  const symptoms = await Promise.all(
    symptomNames.map((name) =>
      prisma.symptom.upsert({
        where: { name },
        create: { name },
        update: {},
      }),
    ),
  );

  await prisma.symptomEntry.createMany({
    data: symptoms.map((symptom, index) => ({
      userId,
      symptomId: symptom.id,
      date: daysAgo(index + 1, 19),
      intensity: index === 0 ? 3 : 2,
    })),
  });

  await prisma.note.createMany({
    data: [
      {
        userId,
        date: daysAgo(4, 21),
        content: 'Tomou anticoncepcional no horário e registrou sono regular.',
      },
      {
        userId,
        date: daysAgo(2, 20),
        content: 'Preferiu ficar em casa e ativou a camada Vera.',
      },
    ],
  });

  await prisma.temperatureEntry.createMany({
    data: [
      { userId, temperature: 36.5, date: daysAgo(4, 7) },
      { userId, temperature: 36.7, date: daysAgo(2, 7) },
      { userId, temperature: 36.6, date: daysAgo(1, 7) },
    ],
  });

  await prisma.weightEntry.create({
    data: { userId, weight: 62.4, date: daysAgo(2, 8) },
  });

  await prisma.waterEntry.createMany({
    data: [
      { userId, amount: 1800, date: daysAgo(2, 22) },
      { userId, amount: 2100, date: daysAgo(1, 22) },
      { userId, amount: 900, date: daysAgo(0, 14) },
    ],
  });

  await prisma.activityEntry.createMany({
    data: [
      {
        userId,
        type: ActivityType.WALKING,
        intensity: ActivityIntensity.LOW,
        duration: 35,
        date: daysAgo(5, 18),
      },
      {
        userId,
        type: ActivityType.YOGA,
        intensity: ActivityIntensity.LOW,
        duration: 25,
        date: daysAgo(2, 18),
      },
    ],
  });

  await prisma.sleepEntry.createMany({
    data: [
      { userId, hours: 7.5, quality: SleepQuality.GOOD, date: daysAgo(3, 7) },
      { userId, hours: 6.2, quality: SleepQuality.FAIR, date: daysAgo(1, 7) },
    ],
  });

  await prisma.medicationEntry.createMany({
    data: [
      {
        userId,
        name: 'Anticoncepcional',
        dose: '1 comprimido',
        date: daysAgo(2, 8),
      },
      {
        userId,
        name: 'Ibuprofeno',
        dose: '400 mg',
        date: daysAgo(1, 14),
      },
    ],
  });
}

async function seedVeraSafetyHistory(
  prisma: PrismaClient,
  userId: string,
  emergencyPhone: string,
) {
  await prisma.emergencyContact.createMany({
    data: [
      {
        userId,
        name: 'Contato verificado',
        phone: emergencyPhone,
        relationship: 'Rede de apoio',
        priority: 0,
        enabled: true,
      },
      {
        userId,
        name: 'Delegacia da Mulher',
        phone: '+550000000190',
        relationship: 'Referência pública',
        priority: 1,
        enabled: false,
      },
    ],
  });

  const home = await prisma.safetyLocation.create({
    data: {
      userId,
      name: 'Casa cadastrada',
      latitude: -9.6481,
      longitude: -35.7172,
      radiusMeters: FIXED_RISK_LOCATION_RADIUS_METERS,
      type: SafetyLocationType.RISK,
      enabled: true,
      address: 'Rua Doutor Pedro Monteiro, 108',
      formattedAddress: 'Rua Doutor Pedro Monteiro, 108, Centro, Maceió - AL',
      placeId: 'demo-maceio-home',
      addressSource: 'demo',
    },
  });

  const work = await prisma.safetyLocation.create({
    data: {
      userId,
      name: 'Trabalho',
      latitude: -9.6622,
      longitude: -35.7047,
      radiusMeters: FIXED_RISK_LOCATION_RADIUS_METERS,
      type: SafetyLocationType.TRUSTED,
      enabled: true,
      address: 'Avenida Fernandes Lima, 1513',
      formattedAddress: 'Avenida Fernandes Lima, 1513, Farol, Maceió - AL',
      placeId: 'demo-maceio-work',
      addressSource: 'demo',
    },
  });

  const session = await prisma.alertSession.create({
    data: {
      userId,
      safetyLocationId: home.id,
      trigger: AlertTrigger.LOCATION,
      status: AlertStatus.RESOLVED,
      level: AlertLevel.NORMAL,
      startedAt: daysAgo(2, 20),
      endedAt: daysAgo(2, 20, 22),
      initialLatitude: home.latitude,
      initialLongitude: home.longitude,
    },
  });

  await prisma.alertEvent.createMany({
    data: [
      {
        userId,
        alertSessionId: session.id,
        type: AlertEventType.SESSION_STARTED,
        message: 'Monitoramento Vera iniciado em local cadastrado.',
        latitude: home.latitude,
        longitude: home.longitude,
        createdAt: daysAgo(2, 20),
      },
      {
        userId,
        alertSessionId: session.id,
        type: AlertEventType.LOCATION_ENTERED,
        message: 'Entrada no raio da casa cadastrada.',
        latitude: home.latitude,
        longitude: home.longitude,
        createdAt: daysAgo(2, 20, 1),
      },
      {
        userId,
        alertSessionId: session.id,
        type: AlertEventType.LOCATION_UPDATED,
        message: 'Amostra pontual de localização registrada.',
        latitude: home.latitude + 0.0002,
        longitude: home.longitude - 0.0001,
        createdAt: daysAgo(2, 20, 10),
      },
      {
        userId,
        alertSessionId: session.id,
        type: AlertEventType.SESSION_CLOSED,
        message: 'Sessão finalizada pela usuária.',
        createdAt: daysAgo(2, 20, 22),
      },
    ],
  });

  await prisma.alertLocationSample.createMany({
    data: [
      {
        userId,
        alertSessionId: session.id,
        latitude: home.latitude,
        longitude: home.longitude,
        accuracyMeters: 18,
        source: LocationSampleSource.BACKGROUND,
        capturedAt: daysAgo(2, 20),
      },
      {
        userId,
        alertSessionId: session.id,
        latitude: home.latitude + 0.0002,
        longitude: home.longitude - 0.0001,
        accuracyMeters: 15,
        source: LocationSampleSource.FOREGROUND,
        capturedAt: daysAgo(2, 20, 10),
      },
    ],
  });

  await prisma.veraLocationSample.createMany({
    data: [
      {
        userId,
        safetyLocationId: work.id,
        latitude: work.latitude,
        longitude: work.longitude,
        accuracyMeters: 22,
        source: LocationSampleSource.BACKGROUND,
        monitoringState: 'baseline',
        address: work.address,
        formattedAddress: work.formattedAddress,
        placeId: work.placeId,
        capturedAt: daysAgo(3, 9, 20),
      },
      {
        userId,
        safetyLocationId: home.id,
        latitude: home.latitude,
        longitude: home.longitude,
        accuracyMeters: 18,
        source: LocationSampleSource.BACKGROUND,
        monitoringState: 'auto_armed_location',
        address: home.address,
        formattedAddress: home.formattedAddress,
        placeId: home.placeId,
        capturedAt: daysAgo(2, 20),
      },
      {
        userId,
        alertSessionId: session.id,
        safetyLocationId: home.id,
        latitude: home.latitude + 0.0002,
        longitude: home.longitude - 0.0001,
        accuracyMeters: 15,
        source: LocationSampleSource.FOREGROUND,
        monitoringState: 'active_alert',
        address: home.address,
        formattedAddress: home.formattedAddress,
        placeId: home.placeId,
        capturedAt: daysAgo(2, 20, 10),
      },
      {
        userId,
        latitude: -9.6507,
        longitude: -35.7194,
        accuracyMeters: 25,
        source: LocationSampleSource.BACKGROUND,
        monitoringState: 'baseline',
        address: 'Rua do Imperador, 85',
        formattedAddress: 'Rua do Imperador, 85, Centro, Maceió - AL',
        placeId: 'demo-maceio-history',
        capturedAt: daysAgo(1, 18, 40),
      },
    ],
  });
}

function daysAgo(days: number, hour = 12, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function dateFromIso(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function maskPhone(value: string) {
  if (value.length <= 4) {
    return '****';
  }

  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
