import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  AlertEventType,
  AlertLevel,
  AlertStatus,
  AlertTrigger,
  PrismaClient,
} from '@prisma/client';
import { EmergencyDispatchService } from '../src/vera/emergency-dispatch.service';
import { LocationGeocodingService } from '../src/vera/location-geocoding.service';
import { MessagingProviderService } from '../src/vera/messaging-provider.service';

const DEFAULT_DEMO_EMAIL = 'vera.demo@cicla.local';

async function main() {
  const prisma = createPrismaClient();
  const email = process.env.DEMO_USER_EMAIL?.trim() || DEFAULT_DEMO_EMAIL;
  const emergencyPhone = process.env.DEMO_EMERGENCY_PHONE?.trim();

  if (!emergencyPhone) {
    throw new Error(
      'DEMO_EMERGENCY_PHONE must be set before sending demo SMS.',
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (!user) {
      throw new Error(
        `Demo user ${email} was not found. Run npm run demo:seed.`,
      );
    }

    await prisma.emergencyContact.deleteMany({
      where: { userId: user.id, priority: 0 },
    });
    await prisma.emergencyContact.create({
      data: {
        userId: user.id,
        name: 'Contato verificado',
        phone: emergencyPhone,
        relationship: 'Rede de apoio',
        priority: 0,
        enabled: true,
      },
    });

    const session = await prisma.alertSession.create({
      data: {
        userId: user.id,
        trigger: AlertTrigger.MANUAL,
        status: AlertStatus.ACTIVE,
        level: AlertLevel.CRITICAL,
        criticalEscalatedAt: new Date(),
        initialLatitude: -9.6481,
        initialLongitude: -35.7172,
      },
    });

    await prisma.alertEvent.createMany({
      data: [
        {
          userId: user.id,
          alertSessionId: session.id,
          type: AlertEventType.SESSION_STARTED,
          message: 'Sessao critica de demonstracao iniciada.',
          latitude: session.initialLatitude,
          longitude: session.initialLongitude,
        },
        {
          userId: user.id,
          alertSessionId: session.id,
          type: AlertEventType.ALERT_ESCALATED,
          message: 'Nivel critico simulado para teste de SMS.',
          latitude: session.initialLatitude,
          longitude: session.initialLongitude,
        },
      ],
    });

    const dispatcher = new EmergencyDispatchService(
      prisma as never,
      new MessagingProviderService(),
      new LocationGeocodingService(),
    );
    const result = await dispatcher.dispatchCriticalAlert(user.id, session.id, {
      source: 'manual',
    });

    console.log(JSON.stringify(result, null, 2));
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

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
