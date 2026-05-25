/** Memory shape from Multer (no Express.Multer.File typing). */
export type MemoryUploadedFile = {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
};

export const PRODUCT_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/x-ms-bmp',
  'image/tiff',
  'image/x-tiff',
  'image/avif',
]);

export function normalizeClientImageMime(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (s === 'image/jpg' || s === 'image/pjpeg' || s === 'image/x-png') {
    return s === 'image/x-png' ? 'image/png' : 'image/jpeg';
  }
  return s;
}

export function sniffImageMime(buf: Buffer): string | null {
  if (!buf?.length) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46
  ) {
    return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (
    (buf.length >= 4 &&
      buf[0] === 0x49 &&
      buf[1] === 0x49 &&
      buf[2] === 0x2a &&
      buf[3] === 0x00) ||
    (buf.length >= 4 &&
      buf[0] === 0x4d &&
      buf[1] === 0x4d &&
      buf[2] === 0x00 &&
      buf[3] === 0x2a)
  ) {
    return 'image/tiff';
  }
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    const brand = buf.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (/^(heic|heix|hevc|heim|heis)$/.test(brand)) return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
  }
  return null;
}

export function resolveProductUploadMime(
  file: MemoryUploadedFile,
): string | null {
  const raw = (file.mimetype || '').toLowerCase().trim();
  const normalized = normalizeClientImageMime(raw);
  if (PRODUCT_IMAGE_MIME.has(normalized)) return normalized;
  if (!raw || raw === 'application/octet-stream') {
    const sniffed = sniffImageMime(file.buffer);
    if (sniffed && PRODUCT_IMAGE_MIME.has(sniffed)) return sniffed;
  }
  return null;
}
