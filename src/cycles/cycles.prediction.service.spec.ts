import { PrismaService } from '../prisma/prisma.service';
import { CyclesPredictionService } from './cycles.prediction.service';

type CycleForPrediction = {
  startDate: Date;
  endDate: Date;
  duration: number;
};

type CycleLogFindManyArgs = {
  where: {
    userId: string;
    endDate: { not: null };
  };
  orderBy: { startDate: 'desc' };
  take: number;
};

type CycleLogDelegateMock = {
  findMany: jest.Mock<Promise<CycleForPrediction[]>, [CycleLogFindManyArgs]>;
};

const cycle = (
  startDate: string,
  endDate: string,
  duration = 5,
): CycleForPrediction => ({
  startDate: new Date(`${startDate}T00:00:00.000Z`),
  endDate: new Date(`${endDate}T00:00:00.000Z`),
  duration,
});

describe('CyclesPredictionService', () => {
  let service: CyclesPredictionService;
  let cycleLog: CycleLogDelegateMock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-24T12:00:00.000Z'));

    cycleLog = {
      findMany: jest.fn<
        Promise<CycleForPrediction[]>,
        [CycleLogFindManyArgs]
      >(),
    };

    const prisma = { cycleLog } as unknown as PrismaService;
    service = new CyclesPredictionService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an empty prediction when no complete cycles exist', async () => {
    cycleLog.findMany.mockResolvedValue([]);

    await expect(service.predict('user-id')).resolves.toEqual({
      nextPeriod: null,
      ovulationDate: null,
      fertileWindow: null,
      message: 'Not enough data to predict. Log at least one complete cycle.',
    });

    expect(cycleLog.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', endDate: { not: null } },
      orderBy: { startDate: 'desc' },
      take: 6,
    });
  });

  it('uses the average distance between cycle starts for predictions', async () => {
    cycleLog.findMany.mockResolvedValue([
      cycle('2026-05-10', '2026-05-14', 4),
      cycle('2026-04-10', '2026-04-15', 5),
      cycle('2026-03-13', '2026-03-18', 5),
    ]);

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

  it('falls back to 28 days when only one complete cycle exists', async () => {
    cycleLog.findMany.mockResolvedValue([cycle('2026-05-10', '2026-05-14', 4)]);

    await expect(service.predict('user-id')).resolves.toMatchObject({
      averageCycleLength: 28,
      nextPeriod: {
        date: '2026-06-07',
      },
      basedOnCycles: 1,
    });
  });
});
