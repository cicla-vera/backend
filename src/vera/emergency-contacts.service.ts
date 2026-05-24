import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmergencyContactDto } from './dto/create-emergency-contact.dto';
import { UpdateEmergencyContactDto } from './dto/update-emergency-contact.dto';

@Injectable()
export class EmergencyContactsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateEmergencyContactDto) {
    return this.prisma.emergencyContact.create({
      data: {
        userId,
        name: dto.name,
        phone: dto.phone,
        relationship: dto.relationship,
        priority: dto.priority ?? 0,
      },
    });
  }

  async findAll(userId: string, includeDisabled = false) {
    return this.prisma.emergencyContact.findMany({
      where: {
        userId,
        enabled: includeDisabled ? undefined : true,
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(userId: string, id: string) {
    const contact = await this.prisma.emergencyContact.findFirst({
      where: { id, userId },
    });

    if (!contact) {
      throw new NotFoundException('Emergency contact not found');
    }

    return contact;
  }

  async update(userId: string, id: string, dto: UpdateEmergencyContactDto) {
    await this.findOne(userId, id);

    return this.prisma.emergencyContact.update({
      where: { id },
      data: {
        name: dto.name,
        phone: dto.phone,
        relationship: dto.relationship,
        priority: dto.priority,
        enabled: dto.enabled,
      },
    });
  }

  async disable(userId: string, id: string) {
    await this.findOne(userId, id);

    return this.prisma.emergencyContact.update({
      where: { id },
      data: { enabled: false },
    });
  }
}
