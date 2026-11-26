import assert from 'node:assert/strict';
const names = [
  'saveProfile',
  'createRun',
  'updateRun',
  'assignVolunteer',
  'openSession',
  'syncOperations',
  'closeSession',
  'previewResults',
  'saveCorrections',
  'publishResults',
  'listHistory',
];
const project = 'harcrun-zhr';
const checks = await Promise.allSettled(
  names.map(async (name) => {
    const response = await fetch(`https://europe-central2-${project}.cloudfunctions.net/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
      signal: AbortSignal.timeout(90000),
    });
    assert.ok(
      response.headers.get('content-type')?.includes('application/json'),
      `${name}: HTTP ${response.status}, żądanie nie dotarło do funkcji callable`,
    );
    const body = await response.json();
    assert.equal(response.status, 403, `${name}: nieoczekiwany status HTTP`);
    assert.equal(
      body.error?.status,
      'PERMISSION_DENIED',
      `${name}: brak kontroli dostępu callable`,
    );
    console.log(`${name}: odrzucono wywołanie bez logowania`);
  }),
);
for (const check of checks) if (check.status === 'rejected') console.error(check.reason.message);
assert.ok(
  checks.every((check) => check.status === 'fulfilled'),
  'Część funkcji nie przeszła testu produkcyjnego.',
);
console.log(
  'Wszystkie 11 funkcji odpowiada i wymaga zweryfikowanego konta. Nie zapisano żadnych danych.',
);
