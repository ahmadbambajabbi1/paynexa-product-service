import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const VALUE_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'email',
  'url',
  'text',
  /** Public URL to an uploaded image (same storage as productImages). */
  'image',
]);

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

export type FieldDefInput = {
  name: string;
  label?: string | null;
  valueType: string;
  required?: boolean;
};

export function normalizeFieldDefinitionsFromDtos(
  rows: FieldDefInput[],
): Prisma.InputJsonValue {
  const seen = new Set<string>();
  const out: object[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!NAME_RE.test(name)) {
      throw new BadRequestException(`Invalid field name: ${row.name}`);
    }
    if (seen.has(name)) {
      throw new BadRequestException(`Duplicate field name: ${name}`);
    }
    seen.add(name);
    if (!VALUE_TYPES.has(row.valueType)) {
      throw new BadRequestException(`Invalid valueType: ${row.valueType}`);
    }
    out.push({
      name,
      label: row.label?.trim() ? String(row.label).trim() : null,
      valueType: row.valueType,
      required: row.required !== false,
    });
  }
  return out;
}

/** Lenient parser for RabbitMQ JSON (skips invalid entries). */
export function parseFieldDefinitionsFromEventPayload(
  raw: unknown,
): Prisma.InputJsonValue {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: object[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const o = item as Record<string, unknown>;
    if (typeof o.name !== 'string' || typeof o.valueType !== 'string') {
      continue;
    }
    const name = o.name.trim();
    if (!NAME_RE.test(name) || seen.has(name)) {
      continue;
    }
    if (!VALUE_TYPES.has(o.valueType)) {
      continue;
    }
    seen.add(name);
    const label =
      o.label != null && typeof o.label === 'string'
        ? o.label.trim() || null
        : null;
    const required = o.required === false ? false : true;
    out.push({ name, label, valueType: o.valueType, required });
  }
  return out;
}
