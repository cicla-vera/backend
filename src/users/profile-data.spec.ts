import { BadRequestException } from '@nestjs/common';
import {
  normalizeEmail,
  normalizeName,
  normalizeOptionalCpf,
  normalizeOptionalPhone,
  parseOptionalBirthDate,
} from './profile-data';

describe('profile data normalization', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-03T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('normalizes email and names before persistence', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
    expect(normalizeName('  Ana   Maria  ')).toBe('Ana Maria');
  });

  it('normalizes local and international Brazilian phone formats', () => {
    expect(normalizeOptionalPhone('(81) 99999-0000')).toBe('81999990000');
    expect(normalizeOptionalPhone('+55 (81) 99999-0000')).toBe('81999990000');
  });

  it('rejects invalid phone formats', () => {
    expect(() => normalizeOptionalPhone('123')).toThrow(BadRequestException);
  });

  it('normalizes valid CPF and rejects invalid CPF', () => {
    expect(normalizeOptionalCpf('529.982.247-25')).toBe('52998224725');
    expect(() => normalizeOptionalCpf('111.111.111-11')).toThrow(
      BadRequestException,
    );
    expect(() => normalizeOptionalCpf('529.982.247-24')).toThrow(
      BadRequestException,
    );
  });

  it('normalizes birth dates to UTC days and rejects future dates', () => {
    expect(parseOptionalBirthDate('1995-03-10T18:00:00-03:00')).toEqual(
      new Date('1995-03-10T00:00:00.000Z'),
    );
    expect(() => parseOptionalBirthDate('2026-06-04')).toThrow(
      BadRequestException,
    );
    expect(() => parseOptionalBirthDate('1995-02-31')).toThrow(
      BadRequestException,
    );
  });
});
