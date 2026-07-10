function evaluateProposal(project, proposal, actor) {
  const violations = [];
  const policy = project.policy || {};
  if (!['script_revision', 'scene_update', 'shot_plan', 'metadata_update'].includes(proposal.type)) violations.push('Unsupported proposal type');
  if (proposal.type === 'script_revision' && !Array.isArray(proposal.payload?.blocks)) violations.push('Script revisions require a blocks array');
  if (proposal.payload?.blocks?.some(block => typeof block.text !== 'string' || block.text.length > 500)) violations.push('Dialogue blocks must be 500 characters or fewer');
  if (policy.protectApprovedContent && proposal.payload?.overwriteApproved === true) violations.push('Approved content cannot be overwritten directly');
  return { allowed: violations.length === 0, violations, requiresHumanReview: true, auditedBy: actor.id };
}

function evaluateGeneration(project, request, actor) {
  const violations = [];
  const policy = project.policy || {};
  const takes = Number(request.takes || 1);
  if (request.type === 'image' && takes > Number(policy.maxImageTakesPerApproval || 4)) violations.push('Image take count exceeds policy');
  if (request.type === 'video' && takes > Number(policy.maxVideoTakesPerApproval || 2)) violations.push('Video take count exceeds policy');
  if (Number(request.estimatedMaximumCost || 0) > Number(policy.projectBudgetUsd || 5)) violations.push('Estimated cost exceeds project budget');
  return { allowed: violations.length === 0, violations, requiresHumanApproval: policy.requireGenerationApproval !== false, requestedBy: actor.id };
}

function applyProposal(project, proposal) {
  if (proposal.type === 'script_revision') return { ...project, blocks: proposal.payload.blocks };
  if (proposal.type === 'scene_update') return { ...project, scenes: proposal.payload.scenes || project.scenes };
  if (proposal.type === 'shot_plan') return { ...project, shots: proposal.payload.shots || [] };
  if (proposal.type === 'metadata_update') return { ...project, publish: { ...(project.publish || {}), ...(proposal.payload.publish || {}) } };
  return project;
}

module.exports = { evaluateProposal, evaluateGeneration, applyProposal };

