// Pet package API helpers: list discovered pets and build file URLs.
// Packages live under ~/.pi/agent/pi-web/pets/ or ~/.codex/pets/ and are
// served by /api/pets + /api/pet/file.

export async function fetchPets({ fetchImpl = fetch } = {}) {
  try {
    const resp = await fetchImpl('/api/pets', { headers: { Accept: 'application/json' } });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data?.pets) ? data.pets : [];
  } catch {
    return [];
  }
}

export function petFileUrl(id, file) {
  return `/api/pet/file?pet=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`;
}

export async function fetchPetManifest(id, { fetchImpl = fetch } = {}) {
  const resp = await fetchImpl(petFileUrl(id, 'pet.json'), {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`pet.json for ${id} failed: ${resp.status}`);
  const manifest = await resp.json();
  if (!manifest || typeof manifest !== 'object') throw new Error('invalid pet.json');
  return manifest;
}

// Resolve the package into concrete URLs the renderer can load. `fio` is the
// optional pi-web extension payload (null when the package has no fio.json).
export function petPackageUrls(id, manifest, fio = null) {
  const sheet =
    typeof manifest?.spritesheetPath === 'string' && manifest.spritesheetPath
      ? manifest.spritesheetPath
      : 'spritesheet.webp';
  return {
    id,
    manifestUrl: petFileUrl(id, 'pet.json'),
    imageUrl: petFileUrl(id, sheet),
    displayName: manifest?.displayName || id,
    spriteVersionNumber:
      typeof manifest?.spriteVersionNumber === 'number' ? manifest.spriteVersionNumber : 0,
    fio: fio && typeof fio === 'object' ? fio : null,
  };
}

// fio.json is a pi-web-only extension manifest (schemaVersion, character,
// persona). It is OPTIONAL: a missing or invalid file resolves to null and the
// package behaves as a plain Codex pet.
export async function fetchFioManifest(id, { fetchImpl = fetch } = {}) {
  try {
    const resp = await fetchImpl(petFileUrl(id, 'fio.json'), {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || typeof data !== 'object' || data.schemaVersion !== 1) return null;
    return data;
  } catch {
    return null;
  }
}
