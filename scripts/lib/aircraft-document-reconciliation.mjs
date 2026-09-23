const bucket = 'aircraft-documents';
const pageSize = 1000;

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function listDirectory(storage, path, depth, objects) {
  if (depth > 4) throw new Error('Aircraft document object depth exceeded.');
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await storage.list(path, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const objectPath = `${path}/${entry.name}`;
      if (entry.id) objects.push(objectPath);
      else await listDirectory(storage, objectPath, depth + 1, objects);
    }
    if (entries.length < pageSize) return;
  }
}

export async function collectAircraftDocumentObjectHashes(client, organizationId) {
  const storage = client.storage.from(bucket);
  const objects = [];
  await listDirectory(storage, organizationId, 0, objects);
  const hashes = {};
  for (const objectPath of objects) {
    const { data, error } = await storage.download(objectPath);
    if (error || !data) throw error ?? new Error('Aircraft document object download failed.');
    hashes[objectPath] = await sha256(await data.arrayBuffer());
  }
  return hashes;
}

export async function reconcileAircraftDocumentStorage(client, organizationId, correlationId) {
  const observedHashes = await collectAircraftDocumentObjectHashes(client, organizationId);
  const { data, error } = await client.rpc('reconcile_aircraft_document_storage', {
    p_organization_id: organizationId,
    p_observed_hashes: observedHashes,
    p_correlation_id: correlationId,
  });
  if (error) throw error;
  return data;
}
