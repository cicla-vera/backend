import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  normalizeName,
  normalizeOptionalCpf,
  normalizeOptionalPhone,
  parseOptionalBirthDate,
} from './profile-data';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      name: user.profile?.name,
      phone: user.profile?.phone,
      phoneVerifiedAt: user.profile?.phoneVerifiedAt ?? null,
      birthDate: user.profile?.birthDate,
      cpf: user.profile?.cpf,
      avgCycleLength: user.profile?.avgCycleLength,
      avgPeriodDuration: user.profile?.avgPeriodDuration,
      createdAt: user.createdAt,
    };
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const name = dto.name !== undefined ? normalizeName(dto.name) : undefined;
    const phone = normalizeOptionalPhone(dto.phone);
    const birthDate = parseOptionalBirthDate(dto.birthDate);
    const cpf = normalizeOptionalCpf(dto.cpf);
    const cpfOwner = cpf
      ? await this.prisma.profile.findUnique({
          where: { cpf },
          select: { userId: true },
        })
      : null;

    if (cpfOwner && cpfOwner.userId !== userId) {
      throw new ConflictException('CPF already in use');
    }

    const updated = await this.prisma.profile.update({
      where: { userId },
      data: {
        name,
        phone,
        phoneVerifiedAt:
          phone !== undefined && phone !== user.profile?.phone
            ? null
            : undefined,
        birthDate,
        cpf,
        avgCycleLength: dto.avgCycleLength,
        avgPeriodDuration: dto.avgPeriodDuration,
      },
    });

    return {
      id: userId,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      name: updated.name,
      phone: updated.phone,
      phoneVerifiedAt: updated.phoneVerifiedAt,
      birthDate: updated.birthDate,
      cpf: updated.cpf,
      avgCycleLength: updated.avgCycleLength,
      avgPeriodDuration: updated.avgPeriodDuration,
    };
  }
}
