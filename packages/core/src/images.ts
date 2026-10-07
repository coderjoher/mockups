import { imageSize } from 'image-size';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class ImageError extends Error {
  statusCode = 422;
  constructor(message: string, public code = 'bad_image') {
    super(message);
  }
}

/** Identifies an uploaded image from its bytes (never trusts the file name or MIME header). */
export function inspectImage(buf: Buffer, allowed: ('png' | 'jpg' | 'webp')[] = ['png', 'jpg', 'webp']): { type: 'png' | 'jpg' | 'webp'; width: number; height: number } {
  if (!buf?.length) throw new ImageError('The file is empty');
  if (buf.length > MAX_UPLOAD_BYTES) throw new ImageError('The file is larger than 25 MB', 'too_large');
  let type: 'png' | 'jpg' | 'webp' | undefined;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) type = 'png';
  else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) type = 'jpg';
  else if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') type = 'webp';
  if (!type || !allowed.includes(type)) {
    throw new ImageError(`Upload a ${allowed.map((a) => a.toUpperCase()).join(' or ')} image`, 'bad_type');
  }
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(buf);
  } catch {
    throw new ImageError('The image could not be read');
  }
  if (!dims.width || !dims.height) throw new ImageError('The image could not be read');
  if (dims.width * dims.height > 12000 * 20000) throw new ImageError('The image has too many pixels', 'too_large');
  return { type, width: dims.width, height: dims.height };
}

export const contentTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
