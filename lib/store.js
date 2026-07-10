const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..', 'data');
const assetRoot = path.join(root, 'assets');
const dbPath = path.join(root, 'db.json');

const blankDb = () => ({ schemaVersion: 3, projects: [], jobs: [], assets: [], tasks: [], comments: [], proposals: [], approvals: [], activity: [], audits: [], auditRequests: [] });

function ensureStore() {
  fs.mkdirSync(assetRoot, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(blankDb(), null, 2));
}

function readDb() {
  ensureStore();
  try {
    const value = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return { ...blankDb(), ...value };
  } catch {
    return blankDb();
  }
}

function writeDb(db) {
  ensureStore();
  const temp = `${dbPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, dbPath);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function listProjects() {
  return readDb().projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getProject(projectId) {
  return readDb().projects.find(project => project.id === projectId) || null;
}

function saveProject(project) {
  const db = readDb();
  const now = new Date().toISOString();
  const saved = {
    ...project,
    id: project.id || id('project'),
    schemaVersion: 2,
    collaboration: {
      mode: project.collaboration?.mode || 'human',
      leadAgent: project.collaboration?.leadAgent || null,
      auditor: project.collaboration?.auditor || 'openclaw-auditor'
    },
    policy: {
      requireGenerationApproval: true,
      requirePublishApproval: true,
      protectApprovedContent: true,
      projectBudgetUsd: 5,
      maxImageTakesPerApproval: 4,
      maxVideoTakesPerApproval: 2,
      ...(project.policy || {})
    },
    createdAt: project.createdAt || now,
    updatedAt: now
  };
  const index = db.projects.findIndex(item => item.id === saved.id);
  if (index === -1) db.projects.unshift(saved); else db.projects[index] = saved;
  writeDb(db);
  addActivity({ projectId: saved.id, actorId: project.actorId || 'human', action: index === -1 ? 'project.created' : 'project.updated', summary: saved.title || 'Untitled project' });
  return saved;
}

function deleteProject(projectId) {
  const db = readDb();
  db.projects = db.projects.filter(project => project.id !== projectId);
  writeDb(db);
}

function createJob(input) {
  const db = readDb();
  const now = new Date().toISOString();
  const job = { id: id('job'), status: 'queued', progress: 0, createdAt: now, updatedAt: now, ...input };
  db.jobs.unshift(job);
  writeDb(db);
  return job;
}

function updateJob(jobId, patch) {
  const db = readDb();
  const index = db.jobs.findIndex(job => job.id === jobId);
  if (index === -1) return null;
  db.jobs[index] = { ...db.jobs[index], ...patch, updatedAt: new Date().toISOString() };
  writeDb(db);
  return db.jobs[index];
}

function listJobs(projectId) {
  const jobs = readDb().jobs;
  return projectId ? jobs.filter(job => job.projectId === projectId) : jobs;
}

function addAsset(input, bytes) {
  const db = readDb();
  const asset = { id: id('asset'), createdAt: new Date().toISOString(), selected: false, ...input };
  const ext = input.extension || extensionFor(input.contentType);
  asset.fileName = `${asset.id}.${ext}`;
  asset.path = path.join(assetRoot, asset.fileName);
  fs.writeFileSync(asset.path, bytes);
  asset.url = `/media/${asset.fileName}`;
  db.assets.unshift(asset);
  writeDb(db);
  return asset;
}

function listAssets(projectId) {
  const assets = readDb().assets;
  return projectId ? assets.filter(asset => asset.projectId === projectId) : assets;
}

function listCollaboration(projectId) {
  const db = readDb();
  const forProject = collection => db[collection].filter(item => item.projectId === projectId);
  return {
    tasks: forProject('tasks'), comments: forProject('comments'), proposals: forProject('proposals'),
    approvals: forProject('approvals'), activity: forProject('activity').slice(0, 100), audits: forProject('audits'), auditRequests: forProject('auditRequests')
  };
}

function createRecord(collection, input, prefix) {
  const db = readDb();
  const now = new Date().toISOString();
  const record = { id: id(prefix), createdAt: now, updatedAt: now, ...input };
  db[collection].unshift(record);
  writeDb(db);
  addActivity({ projectId: record.projectId, actorId: record.actorId || 'human', action: `${prefix}.created`, summary: record.title || record.summary || record.body || prefix });
  return record;
}

function updateRecord(collection, recordId, patch) {
  const db = readDb();
  const index = db[collection].findIndex(item => item.id === recordId);
  if (index === -1) return null;
  db[collection][index] = { ...db[collection][index], ...patch, updatedAt: new Date().toISOString() };
  writeDb(db);
  return db[collection][index];
}

function addActivity(input) {
  const db = readDb();
  const record = { id: id('activity'), createdAt: new Date().toISOString(), ...input };
  db.activity.unshift(record);
  db.activity = db.activity.slice(0, 2000);
  writeDb(db);
  return record;
}

function createTask(input) { return createRecord('tasks', { status: 'ready', priority: 'normal', ...input }, 'task'); }
function updateTask(recordId, patch) { return updateRecord('tasks', recordId, patch); }
function createComment(input) { return createRecord('comments', input, 'comment'); }
function createProposal(input) { return createRecord('proposals', { status: 'pending', ...input }, 'proposal'); }
function updateProposal(recordId, patch) { return updateRecord('proposals', recordId, patch); }
function createApproval(input) { return createRecord('approvals', input, 'approval'); }
function createAudit(input) { return createRecord('audits', input, 'audit'); }
function createAuditRequest(input) { return createRecord('auditRequests', { status: 'queued', attempts: 0, ...input }, 'audit_request'); }
function updateAuditRequest(recordId, patch) { return updateRecord('auditRequests', recordId, patch); }
function listAuditRequests(status) {
  const records = readDb().auditRequests;
  return status ? records.filter(item => item.status === status) : records;
}

function extensionFor(contentType = '') {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('mp4')) return 'mp4';
  return 'bin';
}

module.exports = {
  assetRoot, ensureStore, listProjects, getProject, saveProject, deleteProject,
  createJob, updateJob, listJobs, addAsset, listAssets, listCollaboration,
  createTask, updateTask, createComment, createProposal, updateProposal,
  createApproval, createAudit, createAuditRequest, updateAuditRequest, listAuditRequests, addActivity
};
