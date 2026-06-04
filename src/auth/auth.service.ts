import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  normalizeEmail,
  normalizeName,
  normalizeOptionalCpf,
  normalizeOptionalPhone,
  parseOptionalBirthDate,
} from '../users/profile-data';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    const name = normalizeName(dto.name);
    const phone = normalizeOptionalPhone(dto.phone);
    const birthDate = parseOptionalBirthDate(dto.birthDate);
    const cpf = normalizeOptionalCpf(dto.cpf);
    const [exists, cpfOwner] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
      }),
      cpf
        ? this.prisma.profile.findUnique({
            where: { cpf },
            select: { userId: true },
          })
        : Promise.resolve(null),
    ]);

    if (exists) {
      throw new ConflictException('Email already in use');
    }

    if (cpfOwner) {
      throw new ConflictException('CPF already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        profile: {
          create: {
            name,
            phone,
            birthDate: birthDate ?? null,
            cpf,
            avgCycleLength: dto.initialCycleData?.avgCycleLength,
            avgPeriodDuration: dto.initialCycleData?.avgPeriodDuration,
          },
        },
        ...this.buildInitialCycleCreateData(dto),
      },
      include: {
        profile: true,
      },
    });

    const token = this.jwt.sign({ sub: user.id, email: user.email });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        name: user.profile?.name,
        phoneVerifiedAt: user.profile?.phoneVerifiedAt ?? null,
      },
    };
  }

  async login(dto: LoginDto) {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);

    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.jwt.sign({ sub: user.id, email: user.email });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        name: user.profile?.name,
        phoneVerifiedAt: user.profile?.phoneVerifiedAt ?? null,
      },
    };
  }

  private buildInitialCycleCreateData(dto: RegisterDto) {
    const initialCycleData = dto.initialCycleData;

    if (!initialCycleData?.lastPeriodDate) {
      return {};
    }

    const startDate = new Date(initialCycleData.lastPeriodDate);
    const endDate = initialCycleData.lastPeriodEndDate
      ? new Date(initialCycleData.lastPeriodEndDate)
      : null;

    if (endDate && endDate < startDate) {
      throw new BadRequestException(
        'Last period end date cannot be before start date',
      );
    }

    return {
      cycleLogs: {
        create: {
          startDate,
          endDate,
          duration: endDate
            ? Math.round(
                (endDate.getTime() - startDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : null,
        },
      },
    };
  }
}
