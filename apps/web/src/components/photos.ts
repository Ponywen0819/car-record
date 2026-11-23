import type { CarDB } from '../db/db';
import { savePhoto } from '../db/repository';

/** ~0.3 MB, max 1600 px (SPEC §4.1: phone photos are several MB). */
export const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.3,
  maxWidthOrHeight: 1600,
  useWebWorker: true,
  fileType: 'image/jpeg',
  initialQuality: 0.8,
} as const;

export type Compressor = (file: File, options: typeof COMPRESSION_OPTIONS) => Promise<Blob>;

/** Loaded lazily so the compression library is not in the main bundle. */
const defaultCompress: Compressor = async (file, options) => {
  const { default: imageCompression } = await import('browser-image-compression');
  return imageCompression(file, { ...options });
};

/** Compress a picked/captured image and store it locally (pending upload). Returns the photo id. */
export async function attachPhoto(db: CarDB, file: File, compress: Compressor = defaultCompress): Promise<string> {
  const blob = await compress(file, COMPRESSION_OPTIONS);
  return savePhoto(db, blob);
}
