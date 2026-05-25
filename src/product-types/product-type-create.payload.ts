export type ProductTypeCreatePayload = {
  clientRequestId: string;
  adminUserId: string;
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  lawyerPricingEnabled?: boolean;
  agentPricingEnabled?: boolean;
  fieldDefinitions?: unknown;
  occurredAt?: string;
};

export function isProductTypeCreatePayload(
  body: unknown,
): body is ProductTypeCreatePayload {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const o = body as Record<string, unknown>;
  if (
    typeof o.clientRequestId !== 'string' ||
    typeof o.adminUserId !== 'string' ||
    typeof o.code !== 'string' ||
    typeof o.name !== 'string'
  ) {
    return false;
  }
  if (o.description != null && typeof o.description !== 'string') {
    return false;
  }
  if (o.sortOrder != null && typeof o.sortOrder !== 'number') {
    return false;
  }
  if (
    o.lawyerPricingEnabled != null &&
    typeof o.lawyerPricingEnabled !== 'boolean'
  ) {
    return false;
  }
  if (
    o.agentPricingEnabled != null &&
    typeof o.agentPricingEnabled !== 'boolean'
  ) {
    return false;
  }
  if (o.occurredAt != null && typeof o.occurredAt !== 'string') {
    return false;
  }
  if (o.fieldDefinitions != null && !Array.isArray(o.fieldDefinitions)) {
    return false;
  }
  return true;
}
