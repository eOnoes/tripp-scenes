const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

process.env.TRIPP_HERMES_WRITER_TOKEN = 'test-hermes-writer-token';
process.env.TRIPP_HERMES_DIRECTOR_TOKEN = 'test-hermes-director-token';
process.env.TRIPP_OPENCLAW_TOKEN = 'test-openclaw-token';

test('health and project lifecycle', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`).then(response => response.json());
  assert.equal(health.ok, true);
  const project = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test project', blocks: [{ id: 1, text: 'Hello', char: 'Nova' }], characters: [{ name: 'Nova', color: '#39ff14' }] })
  }).then(response => response.json());
  assert.match(project.id, /^project_/);
  const loaded = await fetch(`${base}/api/projects/${project.id}`).then(response => response.json());
  assert.equal(loaded.title, 'Test project');
  const deleted = await fetch(`${base}/api/projects/${project.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
});

test('rejects invalid projects and generation requests', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const projectResponse = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Invalid' })
  });
  assert.equal(projectResponse.status, 400);
  const generationResponse = await fetch(`${base}/api/generate/image`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'fal' })
  });
  assert.equal(generationResponse.status, 400);
});

test('supports agent-led proposals with OpenClaw audit and human approval', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'Content-Type': 'application/json' };
  const writer = { ...json, Authorization: 'Bearer test-hermes-writer-token' };
  const auditor = { ...json, Authorization: 'Bearer test-openclaw-token' };

  const project = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: json,
    body: JSON.stringify({ title: 'Collaborative test', collaboration: { mode: 'collab' }, blocks: [{ id: 1, text: 'Original', char: 'Nova' }], characters: [{ name: 'Nova', color: '#39ff14' }] })
  }).then(response => response.json());

  const proposalResponse = await fetch(`${base}/api/agent/projects/${project.id}/proposals`, {
    method: 'POST', headers: writer,
    body: JSON.stringify({ type: 'script_revision', summary: 'Improve the hook', reason: 'Stronger opening', payload: { blocks: [{ id: 1, text: 'Revised by Hermes', char: 'Nova' }] } })
  });
  assert.equal(proposalResponse.status, 201);
  const proposal = await proposalResponse.json();
  assert.equal(proposal.status, 'pending');

  const audit = await fetch(`${base}/api/agent/projects/${project.id}/audits`, {
    method: 'POST', headers: auditor,
    body: JSON.stringify({ decision: 'pass', summary: 'Within hard lines', findings: [] })
  }).then(response => response.json());
  assert.equal(audit.decision, 'pass');

  const reviewed = await fetch(`${base}/api/collab/proposals/${proposal.id}/review`, {
    method: 'POST', headers: json, body: JSON.stringify({ projectId: project.id, decision: 'approved' })
  }).then(response => response.json());
  assert.equal(reviewed.status, 'approved');

  const updated = await fetch(`${base}/api/projects/${project.id}`).then(response => response.json());
  assert.equal(updated.blocks[0].text, 'Revised by Hermes');
  assert.equal(updated.collaboration.mode, 'collab');

  await fetch(`${base}/api/projects/${project.id}`, { method: 'DELETE' });
});

test('durably dispatches requested audits through the OpenClaw contract', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'Content-Type': 'application/json' };
  const auditor = { ...json, Authorization: 'Bearer test-openclaw-token' };
  const project = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: json,
    body: JSON.stringify({ title: 'Audit contract test', blocks: [{ id: 1, text: 'A factual claim.', char: 'Nova' }], characters: [{ name: 'Nova', color: '#39ff14' }] })
  }).then(response => response.json());

  const requested = await fetch(`${base}/api/collab/${project.id}/audit-requests`, {
    method: 'POST', headers: json, body: JSON.stringify({ scope: 'script', note: 'Check factual support.' })
  }).then(response => response.json());
  assert.equal(requested.status, 'queued');
  assert.equal(requested.contractVersion, '1.0.0');
  assert.equal(requested.snapshotHash.length, 64);

  const inbox = await fetch(`${base}/api/agent/audits/inbox`, { headers: auditor }).then(response => response.json());
  assert.ok(inbox.some(item => item.id === requested.id));

  const claimed = await fetch(`${base}/api/agent/audits/${requested.id}/claim`, { method: 'POST', headers: auditor }).then(response => response.json());
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.claimedBy, 'openclaw-auditor');

  const invalid = await fetch(`${base}/api/agent/audits/${requested.id}/complete`, {
    method: 'POST', headers: auditor,
    body: JSON.stringify({ decision: 'pass', summary: 'Invalid pass', findings: [{ severity: 'block', message: 'Blocking issue' }] })
  });
  assert.equal(invalid.status, 422);

  const completed = await fetch(`${base}/api/agent/audits/${requested.id}/complete`, {
    method: 'POST', headers: auditor,
    body: JSON.stringify({ decision: 'warn', summary: 'Needs a source', findings: [{ severity: 'warn', code: 'SOURCE', message: 'Attach a primary source.' }], checkedHardLines: ['FACTS_REQUIRE_PRIMARY_SOURCES'] })
  }).then(response => response.json());
  assert.equal(completed.audit.decision, 'warn');
  assert.equal(completed.stale, false);

  const collaboration = await fetch(`${base}/api/collab/${project.id}`).then(response => response.json());
  assert.equal(collaboration.auditRequests.find(item => item.id === requested.id).status, 'completed');
  await fetch(`${base}/api/projects/${project.id}`, { method: 'DELETE' });
});
