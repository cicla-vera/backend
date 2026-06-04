import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CyclesService } from './cycles.service';

type CycleLogDelegateMock = {
  create: jest.Mock;
  delete: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
};

const cycle = (
  id: string,
  startDate: string,
  endDate: string | null,
  duration: number | null = null,
) => ({
  id,
  userId: 'user-id',
  startDate: new Date(`${startDate}T00:00:00.000Z`),
  endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
  duration,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
});

describe('CyclesService', () => {
  let cycleLog: CycleLogDelegateMock;
  let service: CyclesService;

  beforeEach(() => {
    cycleLog = {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    };

    service = new CyclesService({ cycleLog } as unknown as PrismaService);
  });

  it('rejects a cycle whose end date is before its start date', async () => {
    await expect(
      service.create('user-id', {
        startDate: '2026-05-15',
        endDate: '2026-05-10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(cycleLog.findMany).not.toHaveBeenCalled();
    expect(cycleLog.create).not.toHaveBeenCalled();
  });

  it('rejects a cycle that overlaps an existing period', async () => {
    cycleLog.findMany.mockResolvedValue([
      cycle('existing-cycle', '2026-05-10', '2026-05-15', 5),
    ]);

    await expect(
      service.create('user-id', {
        startDate: '2026-05-15',
        endDate: '2026-05-20',
      }),
    ).rejects.toThrow('Cycle period overlaps an existing cycle.');

    expect(cycleLog.create).not.toHaveBeenCalled();
  });

  it('rejects a new cycle while another cycle is still open', async () => {
    cycleLog.findMany.mockResolvedValue([
      cycle('open-cycle', '2026-05-10', null),
    ]);

    await expect(
      service.create('user-id', {
        startDate: '2026-06-10',
      }),
    ).rejects.toThrow('Cycle period overlaps an existing cycle.');

    expect(cycleLog.create).not.toHaveBeenCalled();
  });

  it('creates a non-overlapping cycle and normalizes day duration', async () => {
    cycleLog.findMany.mockResolvedValue([
      cycle('existing-cycle', '2026-04-10', '2026-04-15', 5),
    ]);
    cycleLog.create.mockResolvedValue(
      cycle('created-cycle', '2026-05-10', '2026-05-15', 5),
    );

    await service.create('user-id', {
      startDate: '2026-05-10T23:00:00.000Z',
      endDate: '2026-05-15T02:00:00.000Z',
    });

    expect(cycleLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        startDate: new Date('2026-05-10T23:00:00.000Z'),
        endDate: new Date('2026-05-15T02:00:00.000Z'),
        duration: 5,
      },
    });
  });

  it('recalculates duration when only the end date changes', async () => {
    cycleLog.findFirst.mockResolvedValue(cycle('cycle-id', '2026-05-10', null));
    cycleLog.update.mockResolvedValue(
      cycle('cycle-id', '2026-05-10', '2026-05-15', 5),
    );

    await service.update('user-id', 'cycle-id', {
      endDate: '2026-05-15',
    });

    expect(cycleLog.update).toHaveBeenCalledWith({
      where: { id: 'cycle-id' },
      data: {
        startDate: new Date('2026-05-10T00:00:00.000Z'),
        endDate: new Date('2026-05-15T00:00:00.000Z'),
        duration: 5,
      },
    });
    expect(cycleLog.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', id: { not: 'cycle-id' } },
      select: { id: true, startDate: true, endDate: true },
    });
  });

  it('recalculates duration when only the start date changes', async () => {
    cycleLog.findFirst.mockResolvedValue(
      cycle('cycle-id', '2026-05-10', '2026-05-15', 5),
    );
    cycleLog.update.mockResolvedValue(
      cycle('cycle-id', '2026-05-12', '2026-05-15', 3),
    );

    await service.update('user-id', 'cycle-id', {
      startDate: '2026-05-12',
    });

    expect(cycleLog.update).toHaveBeenCalledWith({
      where: { id: 'cycle-id' },
      data: {
        startDate: new Date('2026-05-12T00:00:00.000Z'),
        endDate: new Date('2026-05-15T00:00:00.000Z'),
        duration: 3,
      },
    });
  });

  it('allows reopening a cycle when it does not overlap later records', async () => {
    cycleLog.findFirst.mockResolvedValue(
      cycle('cycle-id', '2026-05-10', '2026-05-15', 5),
    );
    cycleLog.update.mockResolvedValue(cycle('cycle-id', '2026-05-10', null));

    await service.update('user-id', 'cycle-id', {
      endDate: null,
    });

    expect(cycleLog.update).toHaveBeenCalledWith({
      where: { id: 'cycle-id' },
      data: {
        startDate: new Date('2026-05-10T00:00:00.000Z'),
        endDate: null,
        duration: null,
      },
    });
  });

  it('rejects reopening a cycle when a later cycle exists', async () => {
    cycleLog.findFirst.mockResolvedValue(
      cycle('cycle-id', '2026-05-10', '2026-05-15', 5),
    );
    cycleLog.findMany.mockResolvedValue([
      cycle('later-cycle', '2026-06-10', '2026-06-15', 5),
    ]);

    await expect(
      service.update('user-id', 'cycle-id', {
        endDate: null,
      }),
    ).rejects.toThrow('Cycle period overlaps an existing cycle.');

    expect(cycleLog.update).not.toHaveBeenCalled();
  });

  it('does not update a cycle owned by another user', async () => {
    cycleLog.findFirst.mockResolvedValue(null);

    await expect(
      service.update('user-id', 'other-cycle', {
        endDate: '2026-05-15',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(cycleLog.update).not.toHaveBeenCalled();
  });
});
