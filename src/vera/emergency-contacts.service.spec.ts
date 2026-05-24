import { NotFoundException } from '@nestjs/common';
import type { EmergencyContact } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmergencyContactsService } from './emergency-contacts.service';

type EmergencyContactDelegateMock = {
  create: jest.Mock<
    Promise<EmergencyContact>,
    [
      {
        data: {
          userId: string;
          name: string;
          phone: string;
          relationship?: string;
          priority: number;
        };
      },
    ]
  >;
  findMany: jest.Mock<
    Promise<EmergencyContact[]>,
    [
      {
        where: { userId: string; enabled?: boolean };
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }];
      },
    ]
  >;
  findFirst: jest.Mock<
    Promise<EmergencyContact | null>,
    [{ where: { id: string; userId: string } }]
  >;
  update: jest.Mock<
    Promise<EmergencyContact>,
    [
      {
        where: { id: string };
        data: Partial<EmergencyContact>;
      },
    ]
  >;
};

const baseContact = (
  overrides: Partial<EmergencyContact> = {},
): EmergencyContact => ({
  id: 'contact-id',
  userId: 'user-id',
  name: 'Maria',
  phone: '+5585999999999',
  relationship: 'Sister',
  priority: 0,
  enabled: true,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
  ...overrides,
});

describe('EmergencyContactsService', () => {
  let service: EmergencyContactsService;
  let emergencyContact: EmergencyContactDelegateMock;

  beforeEach(() => {
    emergencyContact = {
      create: jest.fn<
        Promise<EmergencyContact>,
        [
          {
            data: {
              userId: string;
              name: string;
              phone: string;
              relationship?: string;
              priority: number;
            };
          },
        ]
      >(),
      findMany: jest.fn<
        Promise<EmergencyContact[]>,
        [
          {
            where: { userId: string; enabled?: boolean };
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }];
          },
        ]
      >(),
      findFirst: jest.fn<
        Promise<EmergencyContact | null>,
        [{ where: { id: string; userId: string } }]
      >(),
      update: jest.fn<
        Promise<EmergencyContact>,
        [
          {
            where: { id: string };
            data: Partial<EmergencyContact>;
          },
        ]
      >(),
    };

    const prisma = { emergencyContact } as unknown as PrismaService;
    service = new EmergencyContactsService(prisma);
  });

  it('creates an emergency contact for the authenticated user', async () => {
    emergencyContact.create.mockResolvedValue(baseContact());

    await service.create('user-id', {
      name: 'Maria',
      phone: '+5585999999999',
      relationship: 'Sister',
      priority: 0,
    });

    expect(emergencyContact.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        name: 'Maria',
        phone: '+5585999999999',
        relationship: 'Sister',
        priority: 0,
      },
    });
  });

  it('lists active contacts ordered by priority by default', async () => {
    emergencyContact.findMany.mockResolvedValue([baseContact()]);

    await service.findAll('user-id');

    expect(emergencyContact.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', enabled: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('throws when a contact does not belong to the user', async () => {
    emergencyContact.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('user-id', 'other-contact-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft disables an emergency contact', async () => {
    emergencyContact.findFirst.mockResolvedValue(baseContact());
    emergencyContact.update.mockResolvedValue(baseContact({ enabled: false }));

    const result = await service.disable('user-id', 'contact-id');

    expect(emergencyContact.update).toHaveBeenCalledWith({
      where: { id: 'contact-id' },
      data: { enabled: false },
    });
    expect(result.enabled).toBe(false);
  });
});
