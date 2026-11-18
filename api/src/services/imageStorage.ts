import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';

// Phone photos are 3-12 MP. 1200px is plenty to send to a customer and to compare against, and keeps
// the uploads folder small. JPEG, because WhatsApp rejects webp images.
const MAX_SIDE = 1200;

/** Shrinks one uploaded photo, stores it under uploads/images and returns its /uploads/... url. Throws if it is not a readable image. */
export async function storeUploadedImage(buffer: Buffer): Promise<string> {
  // rotate(): honour the phone's EXIF orientation, or portrait shots land sideways.
  const jpeg = await sharp(buffer).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const dir = join(process.cwd(), 'uploads', 'images');
  await mkdir(dir, { recursive: true });
  const url = `/uploads/images/${randomUUID()}.jpg`;
  await writeFile(join(process.cwd(), url), jpeg);
  return url;
}
