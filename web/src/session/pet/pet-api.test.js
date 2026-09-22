import { describe, expect, it, vi } from 'vitest';
import {
  fetchPets,
  fetchPetManifest,
  fetchFioManifest,
  petFileUrl,
  petPackageUrls,
} from './pet-api.js';

describe('pet-api', () => {
  it('fetchPets returns the list on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ pets: [{ id: 'codie', displayName: 'Codie' }] }),
    });
    expect(await fetchPets({ fetchImpl })).toEqual([{ id: 'codie', displayName: 'Codie' }]);
  });

  it('fetchPets degrades to [] on failure', async () => {
    expect(await fetchPets({ fetchImpl: vi.fn().mockRejectedValue(new Error('x')) })).toEqual([]);
    expect(await fetchPets({ fetchImpl: vi.fn().mockResolvedValue({ ok: false }) })).toEqual([]);
  });

  it('petFileUrl encodes params', () => {
    expect(petFileUrl('my pet', 'spritesheet.webp')).toBe(
      '/api/pet/file?pet=my%20pet&file=spritesheet.webp',
    );
  });

  it('petPackageUrls defaults to spritesheet.webp', () => {
    const urls = petPackageUrls('codie', { displayName: 'Codie' });
    expect(urls.imageUrl).toBe('/api/pet/file?pet=codie&file=spritesheet.webp');
    expect(urls.manifestUrl).toBe('/api/pet/file?pet=codie&file=pet.json');
    expect(urls.displayName).toBe('Codie');
  });

  it('petPackageUrls honors spritesheetPath', () => {
    const urls = petPackageUrls('codie', { spritesheetPath: 'sheet.png' });
    expect(urls.imageUrl).toBe('/api/pet/file?pet=codie&file=sheet.png');
  });

  it('fetchPetManifest rejects on http error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchPetManifest('x', { fetchImpl })).rejects.toThrow('404');
  });

  it('fetchFioManifest resolves the extension payload when present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ schemaVersion: 1, character: 'fio', persona: 'observer' }),
    });
    expect(await fetchFioManifest('fio-observer', { fetchImpl })).toEqual({
      schemaVersion: 1,
      character: 'fio',
      persona: 'observer',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/pet/file?pet=fio-observer&file=fio.json',
      expect.anything(),
    );
  });

  it('fetchFioManifest returns null when absent or invalid', async () => {
    // 404 → null (plain Codex package, no extension).
    expect(
      await fetchFioManifest('codie', {
        fetchImpl: vi.fn().mockResolvedValue({ ok: false }),
      }),
    ).toBeNull();
    // Wrong schemaVersion → null.
    expect(
      await fetchFioManifest('codie', {
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ schemaVersion: 99 }),
        }),
      }),
    ).toBeNull();
  });

  it('petPackageUrls carries the fio payload through', () => {
    const withFio = petPackageUrls('fio-observer', {}, { schemaVersion: 1, character: 'fio' });
    expect(withFio.fio).toEqual({ schemaVersion: 1, character: 'fio' });
    expect(petPackageUrls('codie', {}).fio).toBeNull();
    expect(petPackageUrls('codie', {}, 'junk').fio).toBeNull();
  });
});
