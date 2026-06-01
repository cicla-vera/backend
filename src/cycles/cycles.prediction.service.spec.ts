import { PrismaService } from '../prisma/prisma.service';
import { CyclesPredictionService } from './cycles.prediction.service';

type CycleForPrediction = {
  startDate: Date;
  endDate: Date;
  duration: number;
};

type ProfileDelegateMock = {
  findUnique: jest.Mock;
};

type CycleLogDelegateMock = {
  findMany: jest.Mock;
};

const cycle = (
  startDate: string,
  endDate?: string,
  duration = 5,
): any => ({
  startDate: new Date(`${startDate}T00:00:00.000Z`),
  endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
  duration: endDate ? duration : null,
});

describe('CyclesPredictionService', () => {
  let service: CyclesPredictionService;
  let cycleLog: CycleLogDelegateMock;
  let profile: ProfileDelegateMock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-24T12:00:00.000Z'));

    cycleLog = {
      findMany: jest.fn(),
    };

    profile = {
      findUnique: jest.fn(),
    };

    const prisma = { cycleLog, profile } as unknown as PrismaService;
    service = new CyclesPredictionService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an empty prediction when no cycles exist', async () => {
    cycleLog.findMany.mockResolvedValue([]);
    profile.findUnique.mockResolvedValue(null);

    await expect(service.predict('user-id')).resolves.toEqual({
      nextPeriod: null,
      ovulationDate: null,
      fertileWindow: null,
      message: 'Not enough data to predict. Log at least one cycle.',
    });
  });

  it('uses profile avgCycleLength when only one cycle exists', async () => {
    cycleLog.findMany.mockResolvedValue([cycle('2026-05-10')]);
    profile.findUnique.mockResolvedValue({ avgCycleLength: 30 });

    await expect(service.predict('user-id')).resolves.toMatchObject({
      averageCycleLength: 30,
      nextPeriod: {
        date: '2026-06-09',
      },
    });
  });

  it('uses the average distance between cycle starts for predictions', async () => {
    cycleLog.findMany.mockResolvedValue([
      cycle('2026-05-10', '2026-05-14', 4),
      cycle('2026-04-10', '2026-04-15', 5),
      cycle('2026-03-13', '2026-03-18', 5),
    ]);
    profile.findUnique.mockResolvedValue({ avgCycleLength: 28 });

    await expect(service.predict('user-id')).resolves.toEqual({
      averageCycleLength: 29,
      currentCycleDay: 15,
      daysUntilNextPeriod: 15,
      nextPeriod: {
        date: '2026-06-08',
        daysUntil: 15,
      },
      ovulationDate: {
        date: '2026-05-25',
      },
      fertileWindow: {
        start: '2026-05-20',
        end: '2026-05-26',
      },
      basedOnCycles: 3,
    });
  });

  it('falls back to 28 days when no profile data and only one cycle exists', async () => {
    cycleLog.findMany.mockResolvedValue([cycle('2026-05-10')]);
    profile.findUnique.mockResolvedValue(null);

    await expect(service.predict('user-id')).resolves.toMatchObject({
      averageCycleLength: 28,
      nextPeriod: {
        date: '2026-06-07',
      },
      basedOnCycles: 1,
    });
  });
});
