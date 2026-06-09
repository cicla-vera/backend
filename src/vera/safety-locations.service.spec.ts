import { NotFoundException } from '@nestjs/common';
import { SafetyLocationType, type SafetyLocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyLocationsService } from './safety-locations.service';

type SafetyLocationDelegateMock = {
  create: jest.Mock<
    Promise<SafetyLocation>,
    [
      {
        data: {
          userId: string;
          name: string;
          latitude: number;
          longitude: number;
          radiusMeters: number;
          type: SafetyLocationType;
        };
      },
    ]
  >;
  findMany: jest.Mock<
    Promise<SafetyLocation[]>,
    [
      {
        where: { userId: string; enabled?: boolean };
        orderBy: [{ type: 'asc' }, { createdAt: 'asc' }];
      },
    ]
  >;
  findFirst: jest.Mock<
    Promise<SafetyLocation | null>,
    [{ where: { id: string; userId: string } }]
  >;
  update: jest.Mock<
    Promise<SafetyLocation>,
    [
      {
        where: { id: string };
        data: Partial<SafetyLocation>;
      },
    ]
  >;
};

const baseLocation = (
  overrides: Partial<SafetyLocation> = {},
): SafetyLocation => ({
  id: 'location-id',
  userId: 'user-id',
  name: 'Home',
  latitude: -3.7319,
  longitude: -38.5267,
  radiusMeters: 120,
  type: SafetyLocationType.RISK,
  enabled: true,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

describe('SafetyLocationsService', () => {
  let service: SafetyLocationsService;
  let safetyLocation: SafetyLocationDelegateMock;

  beforeEach(() => {
    safetyLocation = {
      create: jest.fn<
        Promise<SafetyLocation>,
        [
          {
            data: {
              userId: string;
              name: string;
              latitude: number;
              longitude: number;
              radiusMeters: number;
              type: SafetyLocationType;
            };
          },
        ]
      >(),
      findMany: jest.fn<
        Promise<SafetyLocation[]>,
        [
          {
            where: { userId: string; enabled?: boolean };
            orderBy: [{ type: 'asc' }, { createdAt: 'asc' }];
          },
        ]
      >(),
      findFirst: jest.fn<
        Promise<SafetyLocation | null>,
        [{ where: { id: string; userId: string } }]
      >(),
      update: jest.fn<
        Promise<SafetyLocation>,
        [
          {
            where: { id: string };
            data: Partial<SafetyLocation>;
          },
        ]
      >(),
    };

    const prisma = { safetyLocation } as unknown as PrismaService;
    service = new SafetyLocationsService(prisma);
  });

  it('creates a risk location by default', async () => {
    safetyLocation.create.mockResolvedValue(baseLocation());

    await service.create('user-id', {
      name: 'Home',
      latitude: -3.7319,
      longitude: -38.5267,
      radiusMeters: 9999,
    });

    expect(safetyLocation.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        name: 'Home',
        latitude: -3.7319,
        longitude: -38.5267,
        radiusMeters: 150,
        type: SafetyLocationType.RISK,
      },
    });
  });

  it('lists active locations by default', async () => {
    safetyLocation.findMany.mockResolvedValue([baseLocation()]);

    await service.findAll('user-id');

    expect(safetyLocation.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', enabled: true },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('can include disabled locations for management screens', async () => {
    safetyLocation.findMany.mockResolvedValue([
      baseLocation(),
      baseLocation({ id: 'disabled-location-id', enabled: false }),
    ]);

    await service.findAll('user-id', true);

    expect(safetyLocation.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', enabled: undefined },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('throws when a location does not belong to the user', async () => {
    safetyLocation.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('user-id', 'other-location-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft disables a safety location', async () => {
    safetyLocation.findFirst.mockResolvedValue(baseLocation());
    safetyLocation.update.mockResolvedValue(baseLocation({ enabled: false }));

    const result = await service.disable('user-id', 'location-id');

    expect(safetyLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-id' },
      data: { enabled: false },
    });
    expect(result.enabled).toBe(false);
  });
});
