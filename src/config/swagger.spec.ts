import type { OpenAPIObject } from '@nestjs/swagger';
import {
  ADMIN_TAGS,
  CUSTOMER_TAGS,
  TALENT_TAGS,
  VENDOR_TAGS,
  buildAdminDocument,
  buildCustomerDocument,
  buildTalentDocument,
  buildVendorDocument,
} from './swagger';

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
    '/api/v1/vendor/bookings': {
      get: {
        tags: ['vendor · bookings'],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/VendorBookingSummaryResponse' } },
            },
          },
        },
      },
    },
    '/api/v1/talent/work': {
      get: {
        tags: ['talent · work'],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TalentWorkSummaryResponse' } },
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
    '/api/v1/catalogue/equipment': {
      get: {
        tags: ['catalogue · equipment'],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/EquipmentCardResponse' } },
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
      VendorBookingSummaryResponse: {
        type: 'object',
        properties: { detail: { $ref: '#/components/schemas/VendorBookingDetail' } },
      },
      VendorBookingDetail: { type: 'object' },
      TalentWorkSummaryResponse: {
        type: 'object',
        properties: { detail: { $ref: '#/components/schemas/TalentWorkDetail' } },
      },
      TalentWorkDetail: { type: 'object' },
      BookingCardResponse: { type: 'object' },
      EquipmentCardResponse: { type: 'object' },
      ApiErrorResponse: { type: 'object' },
    },
  },
});

describe('buildAdminDocument', () => {
  it('keeps admin paths and excludes vendor/talent/customer', () => {
    const doc = buildAdminDocument(full());
    expect(Object.keys(doc.paths)).toContain('/api/v1/admin/payments/{reference}');
    expect(doc.paths['/api/v1/customer/bookings']).toBeUndefined();
    expect(doc.paths['/api/v1/vendor/bookings']).toBeUndefined();
    expect(doc.paths['/api/v1/talent/work']).toBeUndefined();
    expect(doc.paths['/api/v1/catalogue/equipment']).toBeUndefined();
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

describe('buildVendorDocument', () => {
  it('keeps vendor paths and excludes admin/talent/customer', () => {
    const doc = buildVendorDocument(full());
    expect(Object.keys(doc.paths)).toEqual(['/api/v1/vendor/bookings']);
    expect(doc.paths['/api/v1/admin/payments/{reference}']).toBeUndefined();
    expect(doc.paths['/api/v1/talent/work']).toBeUndefined();
    expect(doc.paths['/api/v1/customer/bookings']).toBeUndefined();
  });

  it('keeps only the schemas vendor paths reach, transitively', () => {
    const schemas = Object.keys(buildVendorDocument(full()).components?.schemas ?? {});
    expect(schemas.sort()).toEqual([
      'ApiErrorResponse',
      'VendorBookingDetail',
      'VendorBookingSummaryResponse',
    ]);
  });

  it('lists only the vendor tags in use', () => {
    const tags = buildVendorDocument(full()).tags?.map((t) => t.name);
    expect(tags).toEqual(['vendor · bookings']);
    expect(VENDOR_TAGS.some((t) => t.name === 'vendor · bookings')).toBe(true);
  });

  it('titles itself as the vendor API', () => {
    const doc = buildVendorDocument(full());
    expect(doc.info.title).toBe('Eskista Vendor API');
    expect(doc.info.description).toContain('Rental Lifecycle');
  });
});

describe('buildTalentDocument', () => {
  it('keeps talent paths and excludes admin/vendor/customer', () => {
    const doc = buildTalentDocument(full());
    expect(Object.keys(doc.paths)).toEqual(['/api/v1/talent/work']);
    expect(doc.paths['/api/v1/admin/payments/{reference}']).toBeUndefined();
    expect(doc.paths['/api/v1/vendor/bookings']).toBeUndefined();
    expect(doc.paths['/api/v1/customer/bookings']).toBeUndefined();
  });

  it('keeps only the schemas talent paths reach, transitively', () => {
    const schemas = Object.keys(buildTalentDocument(full()).components?.schemas ?? {});
    expect(schemas.sort()).toEqual([
      'ApiErrorResponse',
      'TalentWorkDetail',
      'TalentWorkSummaryResponse',
    ]);
  });

  it('lists only the talent tags in use', () => {
    const tags = buildTalentDocument(full()).tags?.map((t) => t.name);
    expect(tags).toEqual(['talent · work']);
    expect(TALENT_TAGS.some((t) => t.name === 'talent · work')).toBe(true);
  });

  it('titles itself as the talent API', () => {
    const doc = buildTalentDocument(full());
    expect(doc.info.title).toBe('Eskista Talent API');
    expect(doc.info.description).toContain('Engagement Lifecycle');
  });
});

describe('buildCustomerDocument', () => {
  it('keeps customer and catalogue paths and excludes admin/vendor/talent', () => {
    const doc = buildCustomerDocument(full());
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/catalogue/equipment',
      '/api/v1/customer/bookings',
    ]);
    expect(doc.paths['/api/v1/admin/payments/{reference}']).toBeUndefined();
    expect(doc.paths['/api/v1/vendor/bookings']).toBeUndefined();
    expect(doc.paths['/api/v1/talent/work']).toBeUndefined();
  });

  it('keeps only the schemas customer paths reach, transitively', () => {
    const schemas = Object.keys(buildCustomerDocument(full()).components?.schemas ?? {});
    expect(schemas.sort()).toEqual([
      'ApiErrorResponse',
      'BookingCardResponse',
      'EquipmentCardResponse',
    ]);
  });

  it('lists only the customer tags in use', () => {
    const tags = buildCustomerDocument(full()).tags?.map((t) => t.name);
    expect(tags?.sort()).toEqual(['catalogue · equipment', 'customer · bookings']);
    expect(CUSTOMER_TAGS.some((t) => t.name === 'customer · bookings')).toBe(true);
  });

  it('titles itself as the customer API', () => {
    const doc = buildCustomerDocument(full());
    expect(doc.info.title).toBe('Eskista Customer API');
    expect(doc.info.description).toContain('Booking & Rental Lifecycle');
  });
});
