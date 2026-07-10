const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const store = require('./lib/store');
const providers = require('./lib/providers');
const { configuredAgents, requireAgent } = require('./lib/agents');
const policy = require('./lib/policy');
const auditorContract = require('./lib/auditor-contract');

loadEnv(path.join(__dirname, '.env'));
store.ensureStore();

const app = express();
const preferredPort = Number(process.env.PORT) || 3000;
const exportRoot = path.join(__dirname, 'exports');
fs.mkdirSync(exportRoot, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(store.assetRoot));
app.use('/exports', express.static(exportRoot));

app.get('/api/health', (req, res) => res.json({ ok: true, version: '2.0.0' }));
app.get('/api/capabilities', (req, res) => res.json({ providers: providers.capabilities(), ffmpeg: true }));
app.get('/api/agents', (req, res) => res.json(configuredAgents()));

app.get('/api/projects', (req, res) => res.json(store.listProjects()));
app.get('/api/projects/:id', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});
app.post('/api/projects', (req, res) => {
  const error = validateProject(req.body);
  if (error) return res.status(400).json({ error });
  res.json(store.saveProject(req.body));
});
app.delete('/api/projects/:id', (req, res) => {
  store.deleteProject(req.params.id);
  res.status(204).end();
});

app.get('/api/jobs', (req, res) => res.json(store.listJobs(req.query.projectId)));
app.get('/api/assets', (req, res) => res.json(store.listAssets(req.query.projectId)));

// HUMAN COLLABORATION SURFACE
app.get('/api/collab/:projectId', (req, res) => res.json(store.listCollaboration(req.params.projectId)));
app.post('/api/collab/:projectId/audit-requests', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const envelope = auditorContract.createAuditEnvelope(project, { scope: req.body.scope, note: req.body.note, requiredChecks: req.body.requiredChecks, requestedBy: 'human' });
  const existing = store.listAuditRequests().find(item => item.projectId === project.id && item.snapshotHash === envelope.snapshotHash && ['queued', 'claimed'].includes(item.status));
  if (existing) return res.status(200).json({ ...existing, deduplicated: true });
  const request = store.createAuditRequest({ ...envelope, actorId: 'human', delivery: { webhook: process.env.OPENCLAW_WEBHOOK_URL ? 'pending' : 'polling', lastError: null } });
  notifyOpenClaw(request).catch(error => store.updateAuditRequest(request.id, { delivery: { webhook: 'failed', lastError: error.message }, attempts: request.attempts + 1 }));
  res.status(202).json(request);
});
app.post('/api/collab/:projectId/tasks', (req, res) => res.status(201).json(store.createTask({ projectId: req.params.projectId, actorId: 'human', title: String(req.body.title || '').slice(0, 200), assignedTo: req.body.assignedTo || null, priority: req.body.priority || 'normal' })));
app.post('/api/collab/proposals/:proposalId/review', (req, res) => {
  const project = store.getProject(req.body.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const proposal = store.listCollaboration(project.id).proposals.find(item => item.id === req.params.proposalId);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const decision = req.body.decision;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Decision must be approved or rejected' });
  const updated = store.updateProposal(proposal.id, { status: decision, reviewedBy: 'human', reviewedAt: new Date().toISOString(), reviewNote: String(req.body.note || '').slice(0, 1000) });
  if (decision === 'approved') {
    const next = policy.applyProposal(project, proposal);
    store.saveProject({ ...next, actorId: 'human' });
  }
  store.addActivity({ projectId: project.id, actorId: 'human', action: `proposal.${decision}`, summary: proposal.summary });
  res.json(updated);
});

// AUTHENTICATED LOCAL AGENT API
app.get('/api/agent/me', requireAgent(), (req, res) => res.json({ id: req.agent.id, name: req.agent.name, role: req.agent.role, capabilities: req.agent.capabilities }));
app.get('/api/agent/projects', requireAgent('projects:read'), (req, res) => res.json(store.listProjects()));
app.get('/api/agent/projects/:projectId', requireAgent('projects:read'), (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project, collaboration: store.listCollaboration(project.id), assets: store.listAssets(project.id) });
});
app.post('/api/agent/projects/:projectId/tasks', requireAgent('tasks:create'), (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.status(201).json(store.createTask({ projectId: project.id, actorId: req.agent.id, title: String(req.body.title || '').slice(0, 200), description: String(req.body.description || '').slice(0, 4000), assignedTo: req.body.assignedTo || null, dependsOn: Array.isArray(req.body.dependsOn) ? req.body.dependsOn : [], priority: req.body.priority || 'normal' }));
});
app.patch('/api/agent/tasks/:taskId', requireAgent('tasks:update'), (req, res) => {
  const allowed = ['ready', 'working', 'review', 'blocked', 'approved', 'complete'];
  if (req.body.status && !allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid task status' });
  const task = store.updateTask(req.params.taskId, { status: req.body.status, result: req.body.result, updatedBy: req.agent.id });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  store.addActivity({ projectId: task.projectId, actorId: req.agent.id, action: 'task.updated', summary: `${task.title}: ${task.status}` });
  res.json(task);
});
app.post('/api/agent/projects/:projectId/comments', requireAgent('comments:create'), (req, res) => {
  if (!String(req.body.body || '').trim()) return res.status(400).json({ error: 'Comment body is required' });
  res.status(201).json(store.createComment({ projectId: req.params.projectId, actorId: req.agent.id, body: String(req.body.body).slice(0, 5000), targetType: req.body.targetType || 'project', targetId: req.body.targetId || req.params.projectId }));
});
app.post('/api/agent/projects/:projectId/proposals', requireAgent('proposals:create'), (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const draft = { projectId: project.id, actorId: req.agent.id, type: req.body.type, summary: String(req.body.summary || '').slice(0, 500), reason: String(req.body.reason || '').slice(0, 2000), payload: req.body.payload || {} };
  const audit = policy.evaluateProposal(project, draft, { id: 'openclaw-policy-engine' });
  const proposal = store.createProposal({ ...draft, policyAudit: audit, status: audit.allowed ? 'pending' : 'blocked' });
  res.status(audit.allowed ? 201 : 422).json(proposal);
});
app.post('/api/agent/projects/:projectId/audits', requireAgent('audits:create'), (req, res) => {
  const decision = ['pass', 'warn', 'block'].includes(req.body.decision) ? req.body.decision : 'warn';
  res.status(201).json(store.createAudit({ projectId: req.params.projectId, actorId: req.agent.id, decision, summary: String(req.body.summary || '').slice(0, 1000), findings: Array.isArray(req.body.findings) ? req.body.findings.slice(0, 50) : [], hardLineIds: Array.isArray(req.body.hardLineIds) ? req.body.hardLineIds.slice(0, 50) : [] }));
});
app.get('/api/agent/audits/inbox', requireAgent('audits:create'), (req, res) => {
  const now = Date.now();
  const available = store.listAuditRequests().filter(item => item.status === 'queued' || (item.status === 'claimed' && Date.parse(item.leaseExpiresAt || 0) < now));
  res.json(available);
});
app.post('/api/agent/audits/:requestId/claim', requireAgent('audits:create'), (req, res) => {
  const request = store.listAuditRequests().find(item => item.id === req.params.requestId);
  if (!request) return res.status(404).json({ error: 'Audit request not found' });
  if (request.status === 'completed') return res.status(409).json({ error: 'Audit request already completed' });
  if (request.status === 'claimed' && Date.parse(request.leaseExpiresAt || 0) > Date.now() && request.claimedBy !== req.agent.id) return res.status(409).json({ error: 'Audit request is already claimed' });
  const claimed = store.updateAuditRequest(request.id, { status: 'claimed', claimedBy: req.agent.id, claimedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), attempts: Number(request.attempts || 0) + 1 });
  store.addActivity({ projectId: request.projectId, actorId: req.agent.id, action: 'audit_request.claimed', summary: `${request.scope} audit claimed` });
  res.json(claimed);
});
app.post('/api/agent/audits/:requestId/complete', requireAgent('audits:create'), (req, res) => {
  const request = store.listAuditRequests().find(item => item.id === req.params.requestId);
  if (!request) return res.status(404).json({ error: 'Audit request not found' });
  if (request.status !== 'claimed' || request.claimedBy !== req.agent.id) return res.status(409).json({ error: 'OpenClaw must claim this audit before completing it' });
  const validation = auditorContract.validateAuditResult(req.body);
  if (!validation.valid) return res.status(422).json({ error: 'Audit result does not satisfy the contract', validation });
  const project = store.getProject(request.projectId);
  const stale = project?.updatedAt !== request.projectRevision;
  const audit = store.createAudit({
    projectId: request.projectId, requestId: request.id, actorId: req.agent.id,
    decision: req.body.decision, summary: String(req.body.summary).slice(0, 2000),
    findings: req.body.findings.slice(0, 100), checkedHardLines: req.body.checkedHardLines || [],
    evidence: req.body.evidence || [], contractVersion: request.contractVersion,
    snapshotHash: request.snapshotHash, projectRevision: request.projectRevision, stale
  });
  store.updateAuditRequest(request.id, { status: stale ? 'stale' : 'completed', completedAt: new Date().toISOString(), auditId: audit.id, leaseExpiresAt: null });
  res.status(201).json({ audit, stale });
});
app.post('/api/agent/projects/:projectId/generation-requests', requireAgent('generation:request'), (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const evaluation = policy.evaluateGeneration(project, req.body, req.agent);
  if (!evaluation.allowed) return res.status(422).json({ error: 'Generation request violates project policy', evaluation });
  const approval = store.createApproval({ projectId: project.id, actorId: req.agent.id, type: 'generation', status: 'pending', request: req.body, evaluation });
  res.status(202).json(approval);
});
app.post('/api/assets/upload', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '100mb' }), (req, res) => {
  if (!req.query.projectId || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'projectId and an audio file are required' });
  const contentType = String(req.headers['content-type'] || 'application/octet-stream');
  const asset = store.addAsset({
    projectId: String(req.query.projectId), type: 'audio', provider: 'upload', contentType,
    prompt: String(req.headers['x-file-name'] || 'Voice track').slice(0, 200),
    extension: contentType.includes('mpeg') ? 'mp3' : contentType.includes('wav') ? 'wav' : contentType.includes('mp4') ? 'm4a' : 'bin'
  }, req.body);
  res.status(201).json(asset);
});

app.post('/api/generate/image', (req, res) => {
  const { projectId, sceneId, shotId, provider, prompt } = req.body;
  if (!projectId || !provider || !prompt?.trim()) return res.status(400).json({ error: 'projectId, provider, and prompt are required' });
  const job = store.createJob({ type: 'image', projectId, sceneId, shotId, provider, request: sanitizeGenerationRequest(req.body) });
  res.status(202).json(job);
  runImageJob(job).catch(error => store.updateJob(job.id, { status: 'failed', error: error.message, progress: 100 }));
});

app.post('/api/generate/video', (req, res) => {
  const { projectId, sceneId, shotId, provider, prompt } = req.body;
  if (!projectId || !provider || !prompt?.trim()) return res.status(400).json({ error: 'projectId, provider, and prompt are required' });
  const request = sanitizeGenerationRequest(req.body);
  request.duration = ['5s', '10s'].includes(req.body.duration) ? req.body.duration : '5s';
  const job = store.createJob({ type: 'video', projectId, sceneId, shotId, provider, request });
  res.status(202).json(job);
  runVideoJob(job).catch(error => store.updateJob(job.id, { status: 'failed', error: error.message, progress: 100 }));
});

app.post('/api/render/package', async (req, res) => {
  const project = store.getProject(req.body.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const result = await renderProjectPackage(project, req.body.format || project.output?.format || 'short');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function runImageJob(job) {
  store.updateJob(job.id, { status: 'running', progress: 15 });
  const result = await providers.generateImage(job.request);
  store.updateJob(job.id, { progress: 85, providerRequestId: result.providerRequestId });
  const asset = store.addAsset({
    projectId: job.projectId, sceneId: job.sceneId, shotId: job.shotId,
    jobId: job.id, type: 'image', provider: job.provider,
    prompt: job.request.prompt, contentType: result.contentType
  }, result.bytes);
  store.updateJob(job.id, { status: 'completed', progress: 100, assetId: asset.id });
}

async function runVideoJob(job) {
  store.updateJob(job.id, { status: 'running', progress: 10 });
  const result = await providers.generateVideo(job.request);
  const asset = store.addAsset({
    projectId: job.projectId, sceneId: job.sceneId, shotId: job.shotId,
    jobId: job.id, type: 'video', provider: job.provider,
    prompt: job.request.prompt, contentType: result.contentType
  }, result.bytes);
  store.updateJob(job.id, { status: 'completed', progress: 100, assetId: asset.id, providerRequestId: result.providerRequestId });
}

async function renderProjectPackage(project, format) {
  const safeName = slug(project.title || 'tripp-scenes');
  const folder = path.join(exportRoot, `${safeName}-${Date.now()}`);
  fs.mkdirSync(folder, { recursive: true });
  const assets = store.listAssets(project.id);
  const manifest = {
    schemaVersion: 1, exportedAt: new Date().toISOString(), format,
    project, assets: assets.map(({ path: ignored, ...asset }) => asset),
    youtube: {
      title: project.publish?.title || project.title || 'Untitled',
      description: project.publish?.description || '',
      tags: project.publish?.tags || [], privacyStatus: 'private', containsSyntheticMedia: true
    }
  };
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(folder, 'captions.srt'), buildSrt(project));
  fs.writeFileSync(path.join(folder, 'README.txt'), 'Tripp.Scenes export\r\n\r\nThis package contains the versioned project manifest and draft captions. Select generated takes in the app before final timeline rendering.\r\n');
  const source = assets.find(asset => asset.type === 'image' && fs.existsSync(asset.path));
  const files = ['manifest.json', 'captions.srt', 'README.txt'];
  if (source) {
    const output = path.join(folder, 'video.mp4');
    const vertical = format !== 'long';
    const width = vertical ? 1080 : 1920;
    const height = vertical ? 1920 : 1080;
    const duration = Math.min(600, Math.max(3, project.blocks.reduce((sum, block) => sum + block.text.length / 15, 0)));
    const audio = assets.find(asset => asset.type === 'audio' && fs.existsSync(asset.path));
    const args = ['-y', '-loop', '1', '-i', source.path];
    if (audio) args.push('-i', audio.path);
    args.push('-t', String(duration), '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`, '-r', '30', '-c:v', 'libx264');
    if (audio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    args.push('-movflags', '+faststart', output);
    await runProcess('ffmpeg', args);
    files.push('video.mp4');
  }
  return { url: `/exports/${path.basename(folder)}/${files.includes('video.mp4') ? 'video.mp4' : 'manifest.json'}`, folder: path.basename(folder), files };
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr}`)));
  });
}

function buildSrt(project) {
  let cursor = 0;
  const cues = [];
  const blocks = project.blocks || project.scenes?.flatMap(scene => scene.blocks || []) || [];
  blocks.filter(block => block.text?.trim()).forEach((block, index) => {
    const duration = Math.max(1.5, block.text.length / 15);
    cues.push(`${index + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + duration)}\n${block.char ? `${block.char}: ` : ''}${block.text.replace(/\[[^\]]+\]/g, '').trim()}\n`);
    cursor += duration;
  });
  return cues.join('\n');
}

function srtTime(seconds) {
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  const total = Math.floor(seconds);
  const ss = (total % 60).toString().padStart(2, '0');
  const mm = (Math.floor(total / 60) % 60).toString().padStart(2, '0');
  const hh = Math.floor(total / 3600).toString().padStart(2, '0');
  return `${hh}:${mm}:${ss},${ms}`;
}

function validateProject(project) {
  if (!project || typeof project !== 'object') return 'Project payload is required';
  if (!Array.isArray(project.blocks)) return 'Project blocks must be an array';
  if (project.blocks.some(block => typeof block.text !== 'string' || block.text.length > 7500)) return 'Every block needs valid text under 7,500 characters';
  return null;
}

function sanitizeGenerationRequest(body) {
  return {
    provider: String(body.provider), model: String(body.model || ''),
    prompt: String(body.prompt).slice(0, 7500), negativePrompt: String(body.negativePrompt || '').slice(0, 7500),
    aspectRatio: ['9:16', '16:9', '1:1'].includes(body.aspectRatio) ? body.aspectRatio : '9:16',
    resolution: String(body.resolution || '1K'), quality: String(body.quality || 'medium')
  };
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function listen(port) {
  const server = app.listen(port, () => console.log(`Tripp.Scenes running at http://localhost:${port}`));
  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && process.env.PORT) throw new Error(`Port ${port} is already in use`);
    if (error.code === 'EADDRINUSE') return listen(port + 1);
    throw error;
  });
}

async function notifyOpenClaw(request) {
  const target = process.env.OPENCLAW_WEBHOOK_URL;
  if (!target) return;
  const url = new URL(target);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('OpenClaw webhook must be localhost');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.OPENCLAW_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.OPENCLAW_WEBHOOK_SECRET}` } : {}) },
    body: JSON.stringify({ event: 'tripp.audit.requested', auditRequestId: request.id, projectId: request.projectId, scope: request.scope, callbackBaseUrl: `http://127.0.0.1:${process.env.PORT || preferredPort}/api/agent/audits` })
  });
  if (!response.ok) throw new Error(`OpenClaw webhook returned ${response.status}`);
  store.updateAuditRequest(request.id, { delivery: { webhook: 'delivered', deliveredAt: new Date().toISOString(), lastError: null } });
}

if (require.main === module) listen(preferredPort);
module.exports = app;
