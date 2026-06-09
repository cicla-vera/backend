import { Injectable, NotFoundException } from '@nestjs/common';
import { SafetyLocationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSafetyLocationDto } from './dto/create-safety-location.dto';
import { UpdateSafetyLocationDto } from './dto/update-safety-location.dto';

const FIXED_SAFETY_LOCATION_RADIUS_METERS = 150;

@Injectable()
export class SafetyLocationsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateSafetyLocationDto) {
    return this.prisma.safetyLocation.create({
      data: {
        userId,
        name: dto.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters: FIXED_SAFETY_LOCATION_RADIUS_METERS,
        type: dto.type ?? SafetyLocationType.RISK,
        address: dto.address,
        formattedAddress: dto.formattedAddress,
        placeId: dto.placeId,
        addressSource: dto.addressSource,
      },
    });
  }

  async findAll(userId: string, includeDisabled = false) {
    return this.prisma.safetyLocation.findMany({
      where: {
        userId,
        enabled: includeDisabled ? undefined : true,
      },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(userId: string, id: string) {
    const location = await this.prisma.safetyLocation.findFirst({
      where: { id, userId },
    });

    if (!location) {
      throw new NotFoundException('Safety location not found');
    }

    return location;
  }

  async update(userId: string, id: string, dto: UpdateSafetyLocationDto) {
    await this.findOne(userId, id);

    return this.prisma.safetyLocation.update({
      where: { id },
      data: {
        name: dto.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeters:
          dto.radiusMeters === undefined
            ? undefined
            : FIXED_SAFETY_LOCATION_RADIUS_METERS,
        type: dto.type,
        enabled: dto.enabled,
        address: dto.address,
        formattedAddress: dto.formattedAddress,
        placeId: dto.placeId,
        addressSource: dto.addressSource,
      },
    });
  }

  async disable(userId: string, id: string) {
    await this.findOne(userId, id);

    return this.prisma.safetyLocation.update({
      where: { id },
      data: { enabled: false },
    });
  }
}
