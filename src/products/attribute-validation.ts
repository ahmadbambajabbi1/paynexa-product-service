import { BadRequestException } from '@nestjs/common';

export type FieldDefRow = {
  name: string;
  label?: string | null;
  valueType: string;
  required?: boolean;
};

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isProductImageKey(s: string): boolean {
  return /^product_images\/[a-zA-Z0-9._/-]+$/.test(s);
}

function parseFieldDefs(raw: unknown): FieldDefRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: FieldDefRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    if (typeof o.name !== 'string' || typeof o.valueType !== 'string') {
      continue;
    }
    out.push({
      name: o.name,
      label: typeof o.label === 'string' ? o.label : null,
      valueType: o.valueType,
      required: o.required === false ? false : true,
    });
  }
  return out;
}

function validateOneValue(
  valueType: string,
  value: unknown,
  fieldName: string,
): void {
  switch (valueType) {
    case 'string':
    case 'text':
      if (typeof value !== 'string') {
        throw new BadRequestException(
          `Attribute "${fieldName}" must be a string`,
        );
      }
      if (valueType === 'string' && value.length > 2000) {
        throw new BadRequestException(`Attribute "${fieldName}" is too long`);
      }
      if (valueType === 'text' && value.length > 20000) {
        throw new BadRequestException(`Attribute "${fieldName}" is too long`);
      }
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException(
          `Attribute "${fieldName}" must be a number`,
        );
      }
      return;
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `Attribute "${fieldName}" must be a boolean`,
        );
      }
      return;
    case 'date':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw new BadRequestException(
          `Attribute "${fieldName}" must be an ISO date string`,
        );
      }
      return;
    case 'email':
      if (
        typeof value !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ) {
        throw new BadRequestException(
          `Attribute "${fieldName}" must be an email`,
        );
      }
      return;
    case 'url':
    case 'image':
      if (
        typeof value !== 'string' ||
        (!isHttpUrl(value) && !isProductImageKey(value))
      ) {
        throw new BadRequestException(
          `Attribute "${fieldName}" must be an https URL or a product_images/… key from upload`,
        );
      }
      return;
    default:
      throw new BadRequestException(
        `Unknown valueType for field "${fieldName}"`,
      );
  }
}

export function validateDynamicAttributes(
  fieldDefinitionsJson: unknown,
  attributes: Record<string, unknown>,
): void {
  const defs = parseFieldDefs(fieldDefinitionsJson);
  const allowed = new Set(defs.map((d) => d.name));
  for (const key of Object.keys(attributes)) {
    if (!allowed.has(key)) {
      throw new BadRequestException(`Unknown attribute: ${key}`);
    }
  }
  for (const d of defs) {
    const has = Object.prototype.hasOwnProperty.call(attributes, d.name);
    if (d.required && !has) {
      throw new BadRequestException(`Missing required attribute: ${d.name}`);
    }
    if (has) {
      validateOneValue(d.valueType, attributes[d.name], d.name);
    }
  }
}
