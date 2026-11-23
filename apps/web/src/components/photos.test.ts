import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarDB } from '../db/db';
import * as repo from '../db/repository';
import { COMPRESSION_OPTIONS, attachPhoto } from './photos';

vi.mock('../db/repository', () => import('../test/repoMock'));

const db = {} as CarDB;

beforeEach(() => vi.clearAllMocks());

describe('attachPhoto', () => {
  it('compresses to ~0.3 MB / 1600 px and stores the result', async () => {
    const file = new File(['raw'], 'IMG_0001.HEIC', { type: 'image/heic' });
    const compressed = new Blob(['small'], { type: 'image/jpeg' });
    const compress = vi.fn(async () => compressed);
    const id = await attachPhoto(db, file, compress);
    expect(COMPRESSION_OPTIONS).toMatchObject({ maxSizeMB: 0.3, maxWidthOrHeight: 1600 });
    expect(compress).toHaveBeenCalledWith(file, COMPRESSION_OPTIONS);
    expect(repo.savePhoto).toHaveBeenCalledWith(db, compressed);
    expect(id).toBe('photo-1');
  });
});
