const crypto = require('crypto');

const AGENTS = [
  {
    id: 'hermes-writer', name: 'Hermes Writer', role: 'builder', tokenEnv: 'TRIPP_HERMES_WRITER_TOKEN',
    capabilities: ['projects:read', 'tasks:create', 'tasks:update', 'comments:create', 'proposals:create']
  },
  {
    id: 'hermes-director', name: 'Hermes Director', role: 'builder', tokenEnv: 'TRIPP_HERMES_DIRECTOR_TOKEN',
    capabilities: ['projects:read', 'tasks:create', 'tasks:update', 'comments:create', 'proposals:create', 'assets:read', 'generation:request']
  },
  {
    id: 'openclaw-auditor', name: 'OpenClaw Auditor', role: 'auditor', tokenEnv: 'TRIPP_OPENCLAW_TOKEN',
    capabilities: ['projects:read', 'tasks:create', 'tasks:update', 'comments:create', 'audits:create', 'proposals:review', 'assets:read']
  }
];

function configuredAgents() {
  return AGENTS.map(({ tokenEnv, ...agent }) => ({ ...agent, configured: Boolean(process.env[tokenEnv]) }));
}

function authenticate(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  return AGENTS.find(agent => safeEqual(token, process.env[agent.tokenEnv])) || null;
}

function requireAgent(capability) {
  return (req, res, next) => {
    const agent = authenticate(req);
    if (!agent) return res.status(401).json({ error: 'Valid agent token required' });
    if (capability && !agent.capabilities.includes(capability)) return res.status(403).json({ error: `${agent.name} cannot perform ${capability}` });
    req.agent = agent;
    next();
  };
}

function safeEqual(value, expected) {
  if (!expected || value.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

module.exports = { configuredAgents, requireAgent };

