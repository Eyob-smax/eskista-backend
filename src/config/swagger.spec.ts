import type { OpenAPIObject } from '@nestjs/swagger';
import { ADMIN_TAGS, buildAdminDocument } from './swagger';

const full = (): OpenAPIObject => ({
  openapi: '3.0.0',
  info: { title: 'Eskista Marketplace API', version: '0.1.0' },
  paths: {
    '/api/v1/admin/payments/{reference}': {
      get: {
        tags: ['admin · payments'],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentDetailResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/customer/bookings': {
      get: {
        tags: ['customer · bookings'],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BookingCardResponse' } },
            },
          },
        },
      },
    },
    '/api/v1/administrator-lookalike': { get: { tags: ['other'], responses: {} } },
  },
  components: {
    schemas: {
      PaymentDetailResponse: {
        type: 'object',
        properties: { receipt: { $ref: '#/components/schemas/ReceiptFileResponse' } },
      },
      ReceiptFileResponse: { type: 'object' },
      BookingCardResponse: { type: 'object' },
      ApiErrorResponse: { type: 'object' },
    },
  },
});

describe('buildAdminDocument', () => {
  it('keeps admin paths and adds the Better Auth sign-in', () => {
    const doc = buildAdminDocument(full());
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/v1/admin/payments/{reference}', '/api/auth/sign-in/email']),
    );
    expect(doc.paths['/api/v1/customer/bookings']).toBeUndefined();
    // A prefix match must stop at a path segment.
    expect(doc.paths['/api/v1/administrator-lookalike']).toBeUndefined();
  });

  it('keeps only the schemas admin paths reach, transitively', () => {
    const schemas = Object.keys(buildAdminDocument(full()).components?.schemas ?? {});
    expect(schemas.sort()).toEqual([
      'ApiErrorResponse',
      'PaymentDetailResponse',
      'ReceiptFileResponse',
    ]);
  });

  it('lists only the tags in use, in sidebar order', () => {
    const tags = buildAdminDocument(full()).tags?.map((t) => t.name);
    expect(tags).toEqual(['admin · auth', 'admin · payments']);
    expect(ADMIN_TAGS[0].name).toBe('admin · auth');
  });

  it('titles itself as the admin API', () => {
    const doc = buildAdminDocument(full());
    expect(doc.info.title).toBe('Eskista Admin API');
    expect(doc.info.description).toContain('POST /api/auth/sign-in/email');
  });
});
