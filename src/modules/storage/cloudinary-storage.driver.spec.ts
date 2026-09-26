import { v2 as cloudinary } from 'cloudinary';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { CloudinaryStorageDriver } from './cloudinary-storage.driver';
import { cloudinaryAddress, isPublicMediaKey } from './storage-keys';

vi.mock('cloudinary', () => {
  const uploadStream = vi.fn();
  return {
    v2: {
      config: vi.fn(),
      url: vi.fn(
        (id: string, o: { type: string; format?: string }) =>
          `https://res.cloudinary.com/demo/${o.type}/${id}${o.format ? '.' + o.format : ''}`,
      ),
      utils: {
        private_download_url: vi.fn(
          (id: string) => `https://api.cloudinary.com/v1_1/demo/download?public_id=${id}`,
        ),
      },
      uploader: { upload_stream: uploadStream, destroy: vi.fn() },
    },
  };
});

const config = {
  get: (key: keyof Env) =>
    ({
      CLOUDINARY_CLOUD_NAME: 'demo',
      CLOUDINARY_API_KEY: 'key',
      CLOUDINARY_API_SECRET: 'secret',
      CLOUDINARY_FOLDER: 'eskista',
      STORAGE_PUBLIC_BASE_URL: 'http://localhost:3000/api/v1/files/',
    })[key as string],
} as unknown as ConfigService<Env, true>;

describe('storage keys', () => {
  it('puts only public profile and catalogue media on the CDN', () => {
    expect(isPublicMediaKey('listings/abc/photo.jpg')).toBe(true);
    expect(isPublicMediaKey('vendors/v1/logo/a.png')).toBe(true);
    expect(isPublicMediaKey('talent/t1/public/avatar/a.png')).toBe(true);
    expect(isPublicMediaKey('talent/t1/documents/id.pdf')).toBe(false);
    expect(isPublicMediaKey('vendors/v1/documents/tin.pdf')).toBe(false);
    expect(isPublicMediaKey('customers/u1/documents/licence.pdf')).toBe(false);
    expect(isPublicMediaKey('bookings/ESK-1/payments/receipt.jpg')).toBe(false);
  });

  it('stores images without the extension and everything else as raw with it', () => {
    expect(cloudinaryAddress('talent/t1/public/avatar/x.PNG', 'eskista')).toEqual({
      publicId: 'eskista/talent/t1/public/avatar/x',
      resourceType: 'image',
      deliveryType: 'upload',
    });
    expect(cloudinaryAddress('bookings/ESK-1/agreements/a.md', 'eskista')).toEqual({
      publicId: 'eskista/bookings/ESK-1/agreements/a.md',
      resourceType: 'raw',
      deliveryType: 'authenticated',
    });
  });

  it('keeps a private image private', () => {
    expect(cloudinaryAddress('bookings/ESK-1/payments/r.jpg').deliveryType).toBe('authenticated');
  });
});

describe('CloudinaryStorageDriver', () => {
  const driver = new CloudinaryStorageDriver(config);
  const uploadStream = vi.mocked(cloudinary.uploader.upload_stream);

  beforeEach(() => {
    vi.clearAllMocks();
    uploadStream.mockImplementation(((
      _options: unknown,
      callback: (e: unknown, r: unknown) => void,
    ) => ({
      end: () => callback(null, { public_id: 'x', secure_url: 'https://x' }),
    })) as never);
  });

  it('uploads a private document as an authenticated raw asset under the key', async () => {
    const stored = await driver.put({
      buffer: Buffer.from('%PDF'),
      originalName: 'Fayda.PDF',
      mimeType: 'application/pdf',
      folder: 'talent/t1/documents',
    });

    expect(stored.key).toMatch(/^talent\/t1\/documents\/[0-9a-f-]{36}\.pdf$/);
    const options = uploadStream.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(options).toMatchObject({
      public_id: `eskista/${stored.key}`,
      resource_type: 'raw',
      type: 'authenticated',
      overwrite: true,
    });
  });

  it('never hands a client a Cloudinary URL for a private file', async () => {
    const stored = await driver.put({
      buffer: Buffer.from('x'),
      originalName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      folder: 'bookings/ESK-1/payments',
    });
    expect(stored.url).toBe(`http://localhost:3000/api/v1/files/${stored.key}`);
  });

  it('serves public media straight from the CDN, in its own format', () => {
    expect(driver.urlFor('talent/t1/public/avatar/a.webp')).toBe(
      'https://res.cloudinary.com/demo/upload/eskista/talent/t1/public/avatar/a.webp',
    );
  });

  it('strips unsafe characters from the folder', async () => {
    const stored = await driver.put({
      buffer: Buffer.from('x'),
      originalName: 'a.png',
      mimeType: 'image/png',
      folder: 'talent/t1/../public',
    });
    expect(stored.key.startsWith('talent/t1//public/') || !stored.key.includes('..')).toBe(true);
  });

  it('reads a private file through a time-limited signed download URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(Buffer.from('hello')));

    const bytes = await driver.read('bookings/ESK-1/agreements/a.md');

    expect(bytes.toString()).toBe('hello');
    const [, , options] = vi.mocked(cloudinary.utils.private_download_url).mock.calls[0];
    expect(options).toMatchObject({ resource_type: 'raw', type: 'authenticated' });
    expect((options as { expires_at: number }).expires_at).toBeGreaterThan(Date.now() / 1000);
    fetchSpy.mockRestore();
  });

  it('surfaces a missing file as an error, which the files endpoint turns into 404', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(driver.read('bookings/ESK-1/agreements/a.md')).rejects.toThrow('404');
    fetchSpy.mockRestore();
  });

  it('deletes by public id with the right resource type and purges the CDN', async () => {
    vi.mocked(cloudinary.uploader.destroy).mockResolvedValue({ result: 'ok' });
    await driver.remove('vendors/v1/logo/l.png');
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('eskista/vendors/v1/logo/l', {
      resource_type: 'image',
      type: 'upload',
      invalidate: true,
    });
  });

  it('reports a corrupt image as a bad upload, not a server error', async () => {
    uploadStream.mockImplementationOnce(((
      _options: unknown,
      callback: (e: unknown, r: unknown) => void,
    ) => ({
      end: () => callback({ http_code: 400, message: 'Invalid image file' }, undefined),
    })) as never);
    await expect(
      driver.put({
        buffer: Buffer.from('not a png'),
        originalName: 'a.png',
        mimeType: 'image/png',
        folder: 'talent/t1/public/avatar',
      }),
    ).rejects.toThrow('could not be processed');
  });

  it('refuses traversal', async () => {
    await expect(driver.read('../secrets.txt')).rejects.toThrow('unsafe');
  });
});
