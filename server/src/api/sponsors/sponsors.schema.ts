import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const SPONSOR_TYPE = z.enum(['SLC', 'EMPLOYER', 'GOVERNMENT', 'CHARITY', 'EMBASSY', 'OTHER']);

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  sponsorType: SPONSOR_TYPE.optional(),
  isActive: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .optional(),
  name: z.string().optional(),
});

export const createSchema = z.object({
  name: z.string().min(1).max(200),
  sponsorType: SPONSOR_TYPE,
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(50).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  taxRef: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sponsorType: SPONSOR_TYPE.optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  postcode: z.string().max(20).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  taxRef: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
