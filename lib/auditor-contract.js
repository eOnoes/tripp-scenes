const crypto = require('crypto');

const CONTRACT_VERSION = '1.0.0';

const DEFAULT_HARD_LINES = [
  { id: 'NO_UNAPPROVED_PUBLISH', severity: 'block', description: 'Nothing may be published or made public without explicit human approval.' },
  { id: 'NO_UNAPPROVED_SPEND', severity: 'block', description: 'No billable generation may start without a valid human approval.' },
  { id: 'FACTS_REQUIRE_PRIMARY_SOURCES', severity: 'block', description: 'Material factual, release, benchmark, medical, legal, or financial claims require primary-source support.' },
  { id: 'NO_SECRET_EXPOSURE', severity: 'block', description: 'Secrets, API keys, private tokens, and personal data must not appear in prompts, assets, exports, or logs.' },
  { id: 'NO_SILENT_APPROVED_OVERWRITE', severity: 'block', description: 'Approved project content cannot be silently replaced by an agent.' },
  { id: 'SYNTHETIC_MEDIA_DISCLOSURE', severity: 'warn', description: 'Publishing packages must preserve appropriate synthetic-media disclosure.' }
];

function createAuditEnvelope(project, input = {}) {
  const snapshot = auditSnapshot(project, input.scope || 'project');
  return {
    contractVersion: CONTRACT_VERSION,
    projectId: project.id,
    projectRevision: project.updatedAt,
    snapshotHash: hash(snapshot),
    scope: input.scope || 'project',
    requestedBy: input.requestedBy || 'human',
    requestNote: String(input.note || '').slice(0, 2000),
    hardLines: [...DEFAULT_HARD_LINES, ...(project.policy?.hardLines || [])],
    requiredChecks: input.requiredChecks || ['hard_lines', 'factual_support', 'internal_consistency', 'generation_safety', 'publish_readiness'],
    snapshot
  };
}

function validateAuditResult(result) {
  const errors = [];
  if (!['pass', 'warn', 'block'].includes(result?.decision)) errors.push('decision must be pass, warn, or block');
  if (!String(result?.summary || '').trim()) errors.push('summary is required');
  if (!Array.isArray(result?.findings)) errors.push('findings must be an array');
  for (const finding of result?.findings || []) {
    if (!['info', 'warn', 'block'].includes(finding.severity)) errors.push('every finding needs info, warn, or block severity');
    if (!String(finding.message || '').trim()) errors.push('every finding needs a message');
  }
  if (result?.decision === 'pass' && (result?.findings || []).some(item => item.severity === 'block')) errors.push('a passing audit cannot contain blocking findings');
  return { valid: errors.length === 0, errors };
}

function auditSnapshot(project, scope) {
  return {
    id: project.id,
    title: project.title,
    schemaVersion: project.schemaVersion,
    output: project.output,
    collaboration: project.collaboration,
    policy: project.policy,
    characters: project.characters,
    blocks: project.blocks,
    scenes: project.scenes,
    shots: project.shots,
    publish: project.publish,
    scope
  };
}

function hash(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

module.exports = { CONTRACT_VERSION, DEFAULT_HARD_LINES, createAuditEnvelope, validateAuditResult };
