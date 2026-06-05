import { BadRequestException } from '@nestjs/common';

const BRAZIL_COUNTRY_CODE = '55';
const PHONE_LENGTHS = new Set([10, 11]);

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeName(name: string) {
  const normalized = name.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    throw new BadRequestException('Name is required.');
  }

  return normalized;
}

export function normalizeOptionalPhone(phone?: string) {
  if (phone === undefined) {
    return undefined;
  }

  let normalized = phone.replace(/\D/g, '');

  if (
    normalized.startsWith(BRAZIL_COUNTRY_CODE) &&
    PHONE_LENGTHS.has(normalized.length - BRAZIL_COUNTRY_CODE.length)
  ) {
    normalized = normalized.slice(BRAZIL_COUNTRY_CODE.length);
  }

  if (!PHONE_LENGTHS.has(normalized.length)) {
    throw new BadRequestException(
      'Phone number must contain 10 or 11 Brazilian digits.',
    );
  }

  return normalized;
}

export function normalizeOptionalCpf(cpf?: string) {
  if (cpf === undefined) {
    return undefined;
  }

  const normalized = cpf.replace(/\D/g, '');

  if (!isValidCpf(normalized)) {
    throw new BadRequestException('CPF is invalid.');
  }

  return normalized;
}

export function parseOptionalBirthDate(birthDate?: string) {
  if (birthDate === undefined) {
    return undefined;
  }

  const dateKey = /^\d{4}-\d{2}-\d{2}/.exec(birthDate)?.[0];
  const parsed = new Date(dateKey ? `${dateKey}T00:00:00.000Z` : birthDate);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Birth date is invalid.');
  }

  const normalized = new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );

  if (dateKey && normalized.toISOString().slice(0, 10) !== dateKey) {
    throw new BadRequestException('Birth date is invalid.');
  }

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  if (normalized.getTime() > todayUtc) {
    throw new BadRequestException('Birth date cannot be in the future.');
  }

  return normalized;
}

function isValidCpf(cpf: string) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  return (
    calculateCpfDigit(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    calculateCpfDigit(cpf.slice(0, 10), 11) === Number(cpf[10])
  );
}

function calculateCpfDigit(digits: string, initialWeight: number) {
  const sum = [...digits].reduce(
    (total, digit, index) => total + Number(digit) * (initialWeight - index),
    0,
  );
  const remainder = (sum * 10) % 11;

  return remainder === 10 ? 0 : remainder;
}
