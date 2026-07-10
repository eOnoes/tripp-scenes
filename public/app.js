// STATE
let characters = [
  { name: 'Nova', color: '#39ff14' },
  { name: 'Aria', color: '#00ccff' }
];

let blocks = [
  { id: 1, text: 'AI is fundamentally about pattern recognition. You feed it data, it finds the patterns.', char: 'Nova' },
  { id: 2, text: 'Oh my god, that\'s so cool! But wait — what about when the patterns are wrong?', char: 'Aria' },
  { id: 3, text: 'That\'s an excellent question. The short answer is no. It doesn\'t know it\'s wrong.', char: 'Nova' },
  { id: 4, text: 'Wait, really? So it\'s just confidently incorrect? That\'s honestly kind of relatable.', char: 'Aria' },
  { id: 5, text: '', char: null }
];

let selectedChar = null;
let nextId = 6;
let editMode = false;
let selectedBlocks = new Set();
let dragSrcId = null;
let activeTextarea = null;
let customTags = [];
let currentStoryId = localStorage.getItem('tripp-current-project') || null;
let providerCapabilities = [];
let jobPollTimer = null;
let collabData = { tasks: [], comments: [], proposals: [], approvals: [], activity: [], audits: [], auditRequests: [] };
let collabTab = 'proposals';
let collaboration = { mode: 'human', leadAgent: null, auditor: 'openclaw-auditor' };

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function encoded(value = '') { return encodeURIComponent(String(value)); }

// TRACK ACTIVE TEXTAREA
document.addEventListener('focusin', e => {
  if (e.target.tagName === 'TEXTAREA') activeTextarea = e.target;
});

// TAG INSERTION
function insertTag(tag) {
  if (!activeTextarea) {
    document.getElementById('lastTag').innerHTML = '<span style="color:var(--red)">Click a text block first!</span>';
    return;
  }
  
  const ta = activeTextarea;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = ta.value;
  const before = text.substring(0, start);
  const after = text.substring(end);
  const needsSpaceBefore = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
  const needsSpaceAfter = after.length > 0 && !after.startsWith(' ') && !after.startsWith('\n');
  const insert = (needsSpaceBefore ? ' ' : '') + tag + (needsSpaceAfter ? ' ' : '');
  
  ta.value = before + insert + after;
  ta.selectionStart = ta.selectionEnd = start + insert.length;
  ta.focus();
  
  const blockId = parseInt(ta.closest('.block')?.dataset.id);
  if (blockId) {
    const block = blocks.find(b => b.id === blockId);
    if (block) {
      block.text = ta.value;
      updateCounts();
      const el = ta.closest('.block');
      const count = ta.value.length;
      const ratio = count / 500;
      const barColor = ratio > 0.8 ? 'var(--red)' : ratio > 0.6 ? 'var(--yellow)' : 'var(--green)';
      el.querySelector('.block-bottom span').textContent = `${count} / 500`;
      el.querySelector('.char-progress').style.width = Math.min(ratio * 100, 100) + '%';
      el.querySelector('.char-progress').style.background = barColor;
    }
  }
  
  document.getElementById('lastTag').innerHTML = `<code>${escapeHtml(tag)}</code> inserted`;
  
  document.querySelectorAll('.tag-btn').forEach(btn => {
    if (btn.textContent === tag) {
      btn.classList.add('inserted');
      setTimeout(() => btn.classList.remove('inserted'), 400);
    }
  });
}

function addCustomTag() {
  const input = document.getElementById('customTagInput');
  const tag = input.value.trim();
  if (!tag) return;
  const formatted = tag.startsWith('[') ? tag : `[${tag}]`;
  const grid = document.getElementById('tagGrid');
  const btn = document.createElement('button');
  btn.className = 'tag-btn';
  btn.textContent = formatted;
  btn.onclick = () => insertTag(formatted);
  grid.appendChild(btn);
  customTags.push(formatted);
  document.getElementById('tagCount').textContent = 10 + customTags.length;
  input.value = '';
  input.focus();
}

function insertSceneBreak() {
  if (!activeTextarea) {
    document.getElementById('lastTag').innerHTML = '<span style="color:var(--red)">Click a text block first!</span>';
    return;
  }
  const ta = activeTextarea;
  const start = ta.selectionStart;
  const before = ta.value.substring(0, start);
  const after = ta.value.substring(ta.selectionEnd);
  ta.value = before + '\n---\n' + after;
  ta.selectionStart = ta.selectionEnd = start + 5;
  ta.focus();
  const blockId = Number(ta.closest('.block')?.dataset.id);
  const block = blocks.find(item => item.id === blockId);
  if (block) block.text = ta.value;
  updateCounts();
  document.getElementById('lastTag').innerHTML = '<code>---</code> scene break inserted';
}

// CHIPS
function renderChips() {
  const bar = document.getElementById('charBar');
  const chips = characters.map(c => `
    <div class="char-chip ${selectedChar === c.name ? 'active' : ''}" 
         style="border-color: ${selectedChar === c.name ? c.color : ''}; box-shadow: ${selectedChar === c.name ? '0 0 16px ' + c.color + '33' : ''}"
         onclick="selectChar(decodeURIComponent('${encoded(c.name)}'))">
      <span class="dot" style="background:${c.color}"></span>
      ${escapeHtml(c.name)}
      <span class="remove" onclick="event.stopPropagation();removeChar(decodeURIComponent('${encoded(c.name)}'))">✕</span>
    </div>
  `).join('');
  bar.innerHTML = `<div class="char-bar-title">Cast</div>${chips}<button class="add-char-btn" onclick="openModal()">+ Char</button>`;
}

// BLOCKS
function renderBlocks() {
  const editor = document.getElementById('editor');
  const empty = document.getElementById('emptyState');
  if (blocks.length === 0) {
    empty.style.display = 'flex';
    editor.querySelectorAll('.block, .separator').forEach(b => b.remove());
    updateCounts();
    return;
  }
  
  empty.style.display = 'none';
  
  let html = '';
  blocks.forEach((block, i) => {
    const charObj = characters.find(c => c.name === block.char);
    const color = charObj ? charObj.color : '';
    const assigned = !!block.char;
    const count = block.text.length;
    const ratio = count / 500;
    const barColor = ratio > 0.8 ? 'var(--red)' : ratio > 0.6 ? 'var(--yellow)' : 'var(--green)';
    
    const prevBlock = i > 0 ? blocks[i - 1] : null;
    const isBreak = assigned && prevBlock && prevBlock.char && prevBlock.char !== block.char;
    
    if (isBreak) {
      html += `<div class="separator"><span class="diamond">◆</span> ${escapeHtml(prevBlock.char)} → ${escapeHtml(block.char)} <span class="diamond">◆</span></div>`;
    }
    
    const isSelected = selectedBlocks.has(block.id);
    
    html += `
      <div class="block assigned ${isBreak ? 'break-before' : ''} ${editMode ? 'editable' : ''} ${isSelected ? 'selected' : ''}"
           style="border-top-color: ${assigned ? color : 'transparent'}"
           onclick="handleBlockClick(${block.id}, event)" 
           data-id="${block.id}"
           draggable="${editMode}"
           ondragstart="onDragStart(event, ${block.id})"
           ondragover="onDragOver(event)"
           ondragenter="onDragEnter(event)"
           ondragleave="onDragLeave(event)"
           ondrop="onDrop(event, ${block.id})"
           ondragend="onDragEnd()">
        <div class="drag-dots"><span></span><span></span><span></span><span></span></div>
        <input type="checkbox" class="edit-check" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect(${block.id})">
        <div class="block-delete" onclick="event.stopPropagation();removeBlock(${block.id})">✕</div>
        ${assigned 
          ? `<div class="block-label" style="color:${color}">${escapeHtml(block.char)}</div>`
          : `<div class="unassigned-label">Unassigned</div>`}
        <textarea placeholder="Type dialogue..." 
                  oninput="updateText(${block.id}, this.value); autoResize(this)"
                  onclick="event.stopPropagation()"
                  onfocus="activeTextarea = this">${escapeHtml(block.text)}</textarea>
        <div class="block-bottom">
          <span>${count} / 500</span>
        </div>
        <div class="char-progress" style="width:${Math.min(ratio * 100, 100)}%; background:${barColor}"></div>
      </div>
    `;
  });
  
  editor.querySelectorAll('.block, .separator').forEach(b => b.remove());
  empty.insertAdjacentHTML('afterend', html);
  editor.querySelectorAll('textarea').forEach(autoResize);
  updateCounts();
}

function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.max(50, el.scrollHeight) + 'px';
}

// DURATION
function updateDuration() {
  const totalChars = blocks.reduce((sum, b) => sum + b.text.length, 0);
  const seconds = Math.round(totalChars / 15);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  document.getElementById('durationEst').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  document.querySelectorAll('.fmt').forEach(el => {
    const maxSecs = parseInt(el.dataset.max);
    el.classList.toggle('match', seconds > 0 && seconds <= maxSecs);
  });
}

function updateCounts() {
  const totalChars = blocks.reduce((sum, b) => sum + b.text.length, 0);
  document.getElementById('hintCount').textContent = `${blocks.length} blocks · ${totalChars} chars`;
  updateDuration();
}

// EDIT MODE
function toggleEditMode() {
  editMode = !editMode;
  document.getElementById('editBtn').classList.toggle('btn-edit-active', editMode);
  document.getElementById('editBtn').textContent = editMode ? '✓ Done' : '✎ Edit';
  document.getElementById('editor').classList.toggle('edit-mode', editMode);
  if (!editMode) selectedBlocks.clear();
  renderBlocks();
}

function handleBlockClick(id, event) {
  if (editMode) {
    if (event.target.tagName === 'TEXTAREA' || event.target.classList.contains('edit-check')) return;
    toggleSelect(id);
  } else if (selectedChar) {
    assignBlock(id);
  }
}

function toggleSelect(id) {
  if (selectedBlocks.has(id)) selectedBlocks.delete(id);
  else selectedBlocks.add(id);
  renderBlocks();
}

// DRAG AND DROP
function onDragStart(e, id) {
  if (!editMode) { e.preventDefault(); return; }
  dragSrcId = id;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
}

function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }

function onDragEnter(e) {
  e.preventDefault();
  clearDropIndicators();
  const block = e.target.closest('.block');
  if (!block || block.classList.contains('dragging')) return;
  const rect = block.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  block.classList.add(e.clientY < midY ? 'drop-indicator-top' : 'drop-indicator-bottom');
}

function onDragLeave(e) {
  const block = e.target.closest('.block');
  if (block) block.classList.remove('drop-indicator-top', 'drop-indicator-bottom');
}

function onDrop(e, targetId) {
  e.preventDefault();
  clearDropIndicators();
  if (dragSrcId === null || dragSrcId === targetId) return;
  
  const srcIdx = blocks.findIndex(b => b.id === dragSrcId);
  if (srcIdx === -1) return;
  
  const block = e.target.closest('.block');
  let insertBefore = true;
  if (block) {
    const rect = block.getBoundingClientRect();
    insertBefore = e.clientY < rect.top + rect.height / 2;
  }
  
  if (selectedBlocks.size > 1 && selectedBlocks.has(dragSrcId)) {
    const selectedArr = blocks.filter(b => selectedBlocks.has(b.id));
    const remaining = blocks.filter(b => !selectedBlocks.has(b.id));
    let insertIdx = remaining.findIndex(b => b.id === targetId);
    if (!insertBefore) insertIdx++;
    remaining.splice(insertIdx, 0, ...selectedArr);
    blocks = remaining;
  } else {
    const [moved] = blocks.splice(srcIdx, 1);
    let newIdx = blocks.findIndex(b => b.id === targetId);
    if (!insertBefore) newIdx++;
    blocks.splice(newIdx, 0, moved);
  }
  
  dragSrcId = null;
  renderBlocks();
}

function onDragEnd() {
  dragSrcId = null;
  clearDropIndicators();
  document.querySelectorAll('.block').forEach(b => b.classList.remove('dragging'));
}

function clearDropIndicators() {
  document.querySelectorAll('.block').forEach(b => b.classList.remove('drop-indicator-top', 'drop-indicator-bottom'));
}

// CHARACTER ACTIONS
function selectChar(name) {
  selectedChar = selectedChar === name ? null : name;
  renderChips();
  document.getElementById('hintActive').innerHTML = selectedChar 
    ? `Selected: <span class="active-char">${selectedChar}</span> — click a block`
    : editMode ? 'Click blocks to select, then drag to reorder' : 'Click a chip → click a block to assign';
}

function assignBlock(id) {
  if (selectedChar) {
    const block = blocks.find(b => b.id === id);
    if (block) {
      block.char = block.char === selectedChar ? null : selectedChar;
      renderBlocks();
    }
  }
}

function updateText(id, text) {
  const block = blocks.find(b => b.id === id);
  if (block) {
      block.text = text.slice(0, 500);
      if (text.length > 500) {
        const textarea = document.querySelector(`.block[data-id="${id}"] textarea`);
        if (textarea) textarea.value = block.text;
      }
    const el = document.querySelector(`.block[data-id="${id}"]`);
    if (el) {
      const count = block.text.length;
      const ratio = count / 500;
      const barColor = ratio > 0.8 ? 'var(--red)' : ratio > 0.6 ? 'var(--yellow)' : 'var(--green)';
      el.querySelector('.block-bottom span').textContent = `${count} / 500`;
      el.querySelector('.char-progress').style.width = Math.min(ratio * 100, 100) + '%';
      el.querySelector('.char-progress').style.background = barColor;
    }
    updateCounts();
  }
}

function addBlock() {
  blocks.push({ id: nextId++, text: '', char: null });
  renderBlocks();
  document.getElementById('editor').scrollTop = document.getElementById('editor').scrollHeight;
}

function removeBlock(id) {
  blocks = blocks.filter(b => b.id !== id);
  selectedBlocks.delete(id);
  renderBlocks();
}

function removeChar(name) {
  characters = characters.filter(c => c.name !== name);
  blocks.forEach(b => { if (b.char === name) b.char = null; });
  if (selectedChar === name) selectedChar = null;
  renderChips();
  renderBlocks();
}

// MODAL
function openModal() {
  document.getElementById('addCharModal').classList.add('visible');
  document.getElementById('modalCharName').focus();
}

function closeModal() {
  document.getElementById('addCharModal').classList.remove('visible');
  document.getElementById('modalCharName').value = '';
}

function confirmAddChar() {
  const name = document.getElementById('modalCharName').value.trim();
  const color = document.getElementById('modalCharColor').value;
  if (name && name.length <= 40 && /^[\p{L}\p{N} _.-]+$/u.test(name) && !characters.find(c => c.name === name)) {
    characters.push({ name, color });
    renderChips();
    closeModal();
  }
}

// STORY VAULT — localStorage
function getStories() {
  try { return JSON.parse(localStorage.getItem('tripp-stories') || '[]'); }
  catch { return []; }
}

function saveStories(stories) {
  localStorage.setItem('tripp-stories', JSON.stringify(stories));
}

async function saveCurrentStory() {
  const title = document.getElementById('titleInput').value || 'Untitled';
  const story = {
    id: currentStoryId || undefined,
    title,
    model: document.getElementById('modelSelect').value,
    characters: [...characters],
    blocks: [...blocks],
    customTags: [...customTags],
    nextId,
    savedAt: new Date().toISOString(),
    duration: document.getElementById('durationEst').textContent,
    totalChars: blocks.reduce((sum, b) => sum + b.text.length, 0),
    output: { format: document.getElementById('outputFormat').value, aspectRatio: currentAspectRatio() },
    scenes: buildScenes()
    ,collaboration
  };
  
  try {
    const response = await api('/api/projects', { method: 'POST', body: JSON.stringify(story) });
    story.id = response.id;
    story.createdAt = response.createdAt;
    story.updatedAt = response.updatedAt;
  } catch (error) {
    showToast(`Saved locally — server unavailable: ${error.message}`, true);
    story.id ||= Date.now().toString();
  }
  const stories = getStories();
  const existing = stories.findIndex(s => s.id === story.id);
  if (existing >= 0) stories[existing] = story;
  else stories.unshift(story);
  
  saveStories(stories);
  currentStoryId = story.id;
  localStorage.setItem('tripp-current-project', currentStoryId);
  renderVaultList();
  
  document.getElementById('lastTag').innerHTML = `<code>${escapeHtml(title)}</code> saved ✓`;
  showToast('Project saved');
}

function loadStory(id) {
  const stories = getStories();
  const story = stories.find(s => s.id === id);
  if (!story) return;
  
  currentStoryId = story.id;
  localStorage.setItem('tripp-current-project', currentStoryId);
  document.getElementById('titleInput').value = story.title;
  document.getElementById('modelSelect').value = story.model;
  if (story.output?.format) document.getElementById('outputFormat').value = story.output.format;
  collaboration = story.collaboration || { mode: 'human', leadAgent: null, auditor: 'openclaw-auditor' };
  document.getElementById('collaborationMode').value = collaboration.mode;
  updateModeSummary();
  characters = [...story.characters];
  blocks = [...story.blocks];
  customTags = story.customTags || [];
  nextId = story.nextId || blocks.length + 1;
  
  // Rebuild custom tag buttons
  const grid = document.getElementById('tagGrid');
  grid.querySelectorAll('.tag-btn').forEach((btn, index) => { if (index >= 10) btn.remove(); });
  customTags.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'tag-btn';
    btn.textContent = tag;
    btn.onclick = () => insertTag(tag);
    grid.appendChild(btn);
  });
  document.getElementById('tagCount').textContent = 10 + customTags.length;
  
  renderChips();
  renderBlocks();
  closeVault();
  renderVaultList();
}

async function deleteStory(id, e) {
  e.stopPropagation();
  const stories = getStories().filter(s => s.id !== id);
  saveStories(stories);
  if (currentStoryId === id) currentStoryId = null;
  if (!currentStoryId) localStorage.removeItem('tripp-current-project');
  renderVaultList();
  try { await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* local deletion still succeeds */ }
}

function newStory() {
  currentStoryId = null;
  localStorage.removeItem('tripp-current-project');
  document.getElementById('titleInput').value = '';
  characters = [
    { name: 'Nova', color: '#39ff14' },
    { name: 'Aria', color: '#00ccff' }
  ];
  blocks = [{ id: 1, text: '', char: null }];
  customTags = [];
  nextId = 2;
  collaboration = { mode: 'human', leadAgent: null, auditor: 'openclaw-auditor' };
  document.getElementById('collaborationMode').value = 'human';
  updateModeSummary();
  
  // Remove custom tag buttons
  const grid = document.getElementById('tagGrid');
  grid.querySelectorAll('.tag-btn').forEach((btn, i) => {
    if (i >= 10) btn.remove();
  });
  document.getElementById('tagCount').textContent = '10';
  
  renderChips();
  renderBlocks();
  closeVault();
}

function renderVaultList() {
  const stories = getStories();
  const list = document.getElementById('vaultList');
  
  if (stories.length === 0) {
    list.innerHTML = `
      <div class="vault-empty">
        <pre>
┌────────────────────┐
│  NO SAVED STORIES  │
│                    │
│  Save your first   │
│  storyboard to     │
│  begin building    │
│  the vault.        │
└────────────────────┘
        </pre>
        <span>Your stories will appear here.</span>
      </div>`;
    return;
  }
  
  list.innerHTML = stories.map(s => {
    const date = new Date(s.savedAt);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const charNames = s.characters.map(c => c.name).join(', ');
    
    return `
      <div class="vault-item ${s.id === currentStoryId ? 'active' : ''}" onclick="loadStory(decodeURIComponent('${encoded(s.id)}'))">
        <span class="vault-item-delete" onclick="deleteStory(decodeURIComponent('${encoded(s.id)}'), event)">✕</span>
        <div class="vault-item-title">${escapeHtml(s.title || 'Untitled')}</div>
        <div class="vault-item-meta">
          <span>${dateStr} ${timeStr}</span>
          <span class="chars">${s.totalChars || 0} chars</span>
          <span>${s.duration || '0:00'}</span>
        </div>
        <div class="vault-item-chars">
          ${s.characters.map(c => `<span class="vault-item-char" style="border-color:${c.color};color:${c.color}">${escapeHtml(c.name)}</span>`).join('')}
        </div>
      </div>`;
  }).join('');
}

async function openVault() {
  try {
    const remote = await api('/api/projects');
    const merged = new Map(getStories().map(story => [story.id, story]));
    remote.forEach(story => merged.set(story.id, story));
    saveStories([...merged.values()].sort((a, b) => String(b.updatedAt || b.savedAt).localeCompare(String(a.updatedAt || a.savedAt))));
  } catch { /* keep local vault available offline */ }
  renderVaultList();
  document.getElementById('vaultOverlay').classList.add('open');
  document.getElementById('storyVault').classList.add('open');
}

function closeVault() {
  document.getElementById('vaultOverlay').classList.remove('open');
  document.getElementById('storyVault').classList.remove('open');
}

// EXPORT
function exportJSON() {
  const data = {
    title: document.getElementById('titleInput').value,
    model: document.getElementById('modelSelect').value,
    characters,
    customTags,
    duration: document.getElementById('durationEst').textContent,
    storyboard: blocks.filter(b => b.text || b.char).map(b => ({
      character: b.char,
      text: b.text,
      charCount: b.text.length
    }))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.title || 'storyboard'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildScenes() {
  const scenes = [];
  let current = { id: `scene-${scenes.length + 1}`, title: `Scene ${scenes.length + 1}`, blocks: [] };
  blocks.forEach(block => {
    const parts = block.text.split(/\n---\n/);
    parts.forEach((text, index) => {
      if (index > 0) {
        scenes.push(current);
        current = { id: `scene-${scenes.length + 1}`, title: `Scene ${scenes.length + 1}`, blocks: [] };
      }
      if (text || block.char) current.blocks.push({ ...block, text });
    });
  });
  if (current.blocks.length || scenes.length === 0) scenes.push(current);
  return scenes;
}

function currentAspectRatio() {
  const format = document.getElementById('outputFormat').value;
  return format === 'long' ? '16:9' : format === 'square' ? '1:1' : '9:16';
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

async function loadCapabilities() {
  try {
    const data = await api('/api/capabilities');
    providerCapabilities = data.providers || [];
  } catch {
    providerCapabilities = [];
  }
}

async function openGenerate() {
  if (!currentStoryId) await saveCurrentStory();
  if (!providerCapabilities.length) await loadCapabilities();
  const select = document.getElementById('providerSelect');
  select.innerHTML = providerCapabilities.map(provider =>
    `<option value="${provider.id}">${escapeHtml(provider.label)}${provider.configured ? '' : ' · key needed'}</option>`
  ).join('');
  const firstConfigured = providerCapabilities.find(provider => provider.configured && provider.image);
  if (firstConfigured) select.value = firstConfigured.id;
  document.getElementById('aspectRatio').value = currentAspectRatio();
  const dialogue = blocks.filter(block => block.text.trim()).map(block => `${block.char || 'Narrator'}: ${block.text}`).join('\n');
  if (!document.getElementById('visualPrompt').value) {
    document.getElementById('visualPrompt').value = `Cinematic story scene inspired by this dialogue:\n${dialogue.slice(0, 1800)}\n\nStrong composition, consistent characters, no text or watermark.`;
  }
  syncProviderModels();
  document.getElementById('generateModal').classList.add('visible');
}

function closeGenerate() { document.getElementById('generateModal').classList.remove('visible'); }

function syncProviderModels() {
  const provider = providerCapabilities.find(item => item.id === document.getElementById('providerSelect').value);
  const mediaType = document.getElementById('mediaType').value;
  const model = document.getElementById('providerModel');
  model.innerHTML = ((mediaType === 'video' ? provider?.videoModels : provider?.imageModels) || []).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  const configured = Boolean(provider?.configured && provider?.[mediaType]);
  document.getElementById('generateSubmit').disabled = !configured;
  document.getElementById('generateSubmit').textContent = mediaType === 'video' ? 'Queue Video' : 'Queue Image';
  document.getElementById('clipDuration').closest('label').style.display = mediaType === 'video' ? '' : 'none';
  document.getElementById('generationSummary').innerHTML = provider
    ? `<span class="${configured ? 'ok' : 'warn'}">${configured ? '● Key present' : `△ ${provider[mediaType] ? 'API key required' : 'media type unsupported'}`}</span> · ${escapeHtml(provider.label)} · ${mediaType} generation · ${provider.async ? 'queued job' : 'direct job'}<br>Credentials are verified when a job runs. One take will be stored in the project asset vault. Keys never leave the server.`
    : 'No providers are available.';
}

async function submitGeneration() {
  const prompt = document.getElementById('visualPrompt').value.trim();
  if (!prompt) return showToast('Add a visual prompt first', true);
  const button = document.getElementById('generateSubmit');
  button.disabled = true;
  button.textContent = 'Queueing...';
  try {
    const mediaType = document.getElementById('mediaType').value;
    await api(`/api/generate/${mediaType}`, { method: 'POST', body: JSON.stringify({
      projectId: currentStoryId,
      sceneId: buildScenes()[0]?.id,
      provider: document.getElementById('providerSelect').value,
      model: document.getElementById('providerModel').value,
      aspectRatio: document.getElementById('aspectRatio').value,
      quality: document.getElementById('generationQuality').value,
      duration: document.getElementById('clipDuration').value,
      prompt,
      negativePrompt: document.getElementById('negativePrompt').value
    }) });
    closeGenerate();
    openAssets();
    showToast('Generation queued');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = document.getElementById('mediaType').value === 'video' ? 'Queue Video' : 'Queue Image';
  }
}

function openAssets() {
  document.getElementById('assetOverlay').classList.add('open');
  document.getElementById('assetDrawer').classList.add('open');
  refreshAssets();
  clearInterval(jobPollTimer);
  jobPollTimer = setInterval(refreshAssets, 2500);
}

function closeAssets() {
  document.getElementById('assetOverlay').classList.remove('open');
  document.getElementById('assetDrawer').classList.remove('open');
  clearInterval(jobPollTimer);
}

async function refreshAssets() {
  if (!currentStoryId) return;
  try {
    const [jobs, assets] = await Promise.all([
      api(`/api/jobs?projectId=${encodeURIComponent(currentStoryId)}`),
      api(`/api/assets?projectId=${encodeURIComponent(currentStoryId)}`)
    ]);
    document.getElementById('assetCount').textContent = assets.length;
    document.getElementById('assetStatus').textContent = `${assets.length} assets · ${jobs.filter(job => ['queued', 'running'].includes(job.status)).length} active jobs`;
    const jobHtml = jobs.slice(0, 8).map(job => `<div class="job-row ${job.status}">
      <div class="job-top"><span>${escapeHtml(job.provider)} · ${escapeHtml(job.type)}</span><span class="job-state">${escapeHtml(job.status)}</span></div>
      ${job.error ? `<div style="color:var(--red);margin-top:6px">${escapeHtml(job.error)}</div>` : ''}
      <div class="job-progress"><span style="width:${Number(job.progress) || 0}%"></span></div></div>`).join('');
    const assetHtml = assets.map(asset => `<div class="asset-card">
      ${asset.type === 'video' ? `<video src="${asset.url}" controls></video>` : asset.type === 'audio' ? `<div style="padding:20px 10px"><audio src="${asset.url}" controls style="width:100%"></audio></div>` : `<img src="${asset.url}" alt="Generated visual take">`}
      <div class="asset-card-info"><strong>${escapeHtml(asset.provider)} take</strong>${escapeHtml(asset.prompt || '')}</div></div>`).join('');
    document.getElementById('assetList').innerHTML = jobHtml + assetHtml || '<div class="vault-empty">No assets yet. Queue a visual take from Generate.</div>';
  } catch (error) {
    document.getElementById('assetStatus').textContent = error.message;
  }
}

async function uploadAudio(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!currentStoryId) await saveCurrentStory();
  try {
    const response = await fetch(`/api/assets/upload?projectId=${encodeURIComponent(currentStoryId)}`, {
      method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': file.name }, body: file
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Audio upload failed');
    showToast('Audio added to project');
    refreshAssets();
  } catch (error) { showToast(error.message, true); }
  finally { input.value = ''; }
}

async function exportPackage() {
  if (!currentStoryId) await saveCurrentStory();
  try {
    const result = await api('/api/render/package', { method: 'POST', body: JSON.stringify({ projectId: currentStoryId, format: document.getElementById('outputFormat').value }) });
    showToast(`Package ready: ${result.folder}`);
    window.open(result.url, '_blank', 'noopener');
  } catch (error) { showToast(error.message, true); }
}

function showToast(message, isError = false) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

const modeDetails = {
  human: ['Human-led', 'You write. Agents review only when invited.'],
  agent: ['Agent-led', 'Hermes builds the draft. You approve milestones and all spending.'],
  collab: ['Collaborative', 'You and Hermes build together through tasks, comments, and proposals.']
};

async function changeCollaborationMode(mode) {
  collaboration = {
    ...collaboration,
    mode,
    leadAgent: mode === 'agent' ? 'hermes-writer' : collaboration.leadAgent
  };
  updateModeSummary();
  if (currentStoryId) await saveCurrentStory();
}

function updateModeSummary() {
  const details = modeDetails[collaboration.mode] || modeDetails.human;
  const label = document.getElementById('teamModeLabel');
  const description = document.getElementById('teamModeDescription');
  if (label) {
    label.textContent = details[0];
    label.className = `mode-${collaboration.mode}`;
  }
  if (description) description.textContent = details[1];
}

async function openCollaboration() {
  if (!currentStoryId) await saveCurrentStory();
  document.getElementById('collabOverlay').classList.add('open');
  document.getElementById('collabDrawer').classList.add('open');
  await refreshCollaboration();
}

function closeCollaboration() {
  document.getElementById('collabOverlay').classList.remove('open');
  document.getElementById('collabDrawer').classList.remove('open');
}

async function refreshCollaboration() {
  if (!currentStoryId) return;
  try {
    const [data, agents] = await Promise.all([api(`/api/collab/${encodeURIComponent(currentStoryId)}`), api('/api/agents')]);
    collabData = data;
    document.getElementById('agentRoster').innerHTML = agents.map(agent => `<div class="agent-chip ${agent.configured ? 'configured' : ''}"><strong>${escapeHtml(agent.name)}</strong><span class="presence">${agent.configured ? '● connected' : '○ token needed'}</span><br>${escapeHtml(agent.role)}</div>`).join('');
    const pending = data.proposals.filter(item => item.status === 'pending').length + data.approvals.filter(item => item.status === 'pending').length + data.auditRequests.filter(item => ['queued', 'claimed'].includes(item.status)).length;
    document.getElementById('teamBadge').textContent = pending;
    renderCollabFeed();
  } catch (error) { showToast(error.message, true); }
}

function switchCollabTab(tab, button) {
  collabTab = tab;
  document.querySelectorAll('.collab-tabs button').forEach(item => item.classList.toggle('active', item === button));
  document.getElementById('taskComposer').style.display = tab === 'tasks' ? 'grid' : 'none';
  renderCollabFeed();
}

function renderCollabFeed() {
  const feed = document.getElementById('collabFeed');
  let html = '';
  if (collabTab === 'proposals') {
    html = collabData.proposals.map(item => `<article class="collab-card ${item.status}"><div class="collab-card-head"><span>${escapeHtml(item.actorId)}</span><span>${escapeHtml(item.status)}</span></div><strong>${escapeHtml(item.summary || item.type)}</strong><p>${escapeHtml(item.reason || 'No rationale supplied.')}</p>${item.policyAudit?.violations?.length ? `<p style="color:var(--red)">${item.policyAudit.violations.map(escapeHtml).join(' · ')}</p>` : ''}${item.status === 'pending' ? `<div class="collab-actions"><button class="btn btn-primary" onclick="reviewProposal('${item.id}','approved')">Accept</button><button class="btn" onclick="reviewProposal('${item.id}','rejected')">Reject</button></div>` : ''}</article>`).join('');
  } else if (collabTab === 'tasks') {
    html = collabData.tasks.map(item => `<article class="collab-card ${item.status}"><div class="collab-card-head"><span>${escapeHtml(item.assignedTo || 'unassigned')}</span><span>${escapeHtml(item.status)}</span></div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description || '')}</p></article>`).join('');
  } else if (collabTab === 'audits') {
    const requestCards = collabData.auditRequests.map(item => `<article class="collab-card ${item.status === 'stale' ? 'warn' : ''}"><div class="collab-card-head"><span>OpenClaw request · ${escapeHtml(item.scope)}</span><span>${escapeHtml(item.status)}</span></div><strong>${escapeHtml(item.status === 'queued' ? 'Waiting for OpenClaw' : item.status === 'claimed' ? 'Audit in progress' : item.status === 'stale' ? 'Completed against an older revision' : 'Audit completed')}</strong><p>Revision ${escapeHtml(item.projectRevision || '')} · contract ${escapeHtml(item.contractVersion || '')}${item.delivery?.lastError ? ` · ${escapeHtml(item.delivery.lastError)}` : ''}</p></article>`).join('');
    const auditCards = collabData.audits.map(item => `<article class="collab-card ${item.decision}"><div class="collab-card-head"><span>${escapeHtml(item.actorId)}</span><span>${escapeHtml(item.decision)}</span></div><strong>${escapeHtml(item.summary || 'Audit')}</strong><p>${(item.findings || []).map(finding => escapeHtml(typeof finding === 'string' ? finding : `${finding.severity}: ${finding.message}`)).join(' · ')}</p>${item.stale ? '<p style="color:var(--yellow)">Project changed after this audit was requested.</p>' : ''}</article>`).join('');
    html = requestCards + auditCards;
  } else {
    html = collabData.activity.map(item => `<article class="collab-card"><div class="collab-card-head"><span>${escapeHtml(item.actorId)}</span><span>${new Date(item.createdAt).toLocaleString()}</span></div><strong>${escapeHtml(item.action)}</strong><p>${escapeHtml(item.summary || '')}</p></article>`).join('');
  }
  feed.innerHTML = html || '<div class="vault-empty">Nothing here yet. Your team activity will appear here.</div>';
}

async function requestOpenClawAudit() {
  if (!currentStoryId) await saveCurrentStory();
  try {
    const request = await api(`/api/collab/${encodeURIComponent(currentStoryId)}/audit-requests`, {
      method: 'POST', body: JSON.stringify({ scope: document.getElementById('auditScope').value, note: document.getElementById('auditNote').value })
    });
    document.getElementById('auditNote').value = '';
    collabTab = 'audits';
    document.querySelectorAll('.collab-tabs button').forEach(item => item.classList.toggle('active', item.dataset.tab === 'audits'));
    document.getElementById('taskComposer').style.display = 'none';
    await refreshCollaboration();
    showToast(request.deduplicated ? 'Audit already queued for this revision' : 'OpenClaw audit requested');
  } catch (error) { showToast(error.message, true); }
}

async function createHumanTask() {
  const input = document.getElementById('humanTaskTitle');
  const title = input.value.trim();
  if (!title) return;
  try {
    await api(`/api/collab/${encodeURIComponent(currentStoryId)}/tasks`, { method: 'POST', body: JSON.stringify({ title, assignedTo: document.getElementById('humanTaskAssignee').value }) });
    input.value = '';
    await refreshCollaboration();
  } catch (error) { showToast(error.message, true); }
}

async function reviewProposal(proposalId, decision) {
  try {
    await api(`/api/collab/proposals/${encodeURIComponent(proposalId)}/review`, { method: 'POST', body: JSON.stringify({ projectId: currentStoryId, decision }) });
    if (decision === 'approved') {
      const project = await api(`/api/projects/${encodeURIComponent(currentStoryId)}`);
      loadProjectData(project);
    }
    await refreshCollaboration();
    showToast(`Proposal ${decision}`);
  } catch (error) { showToast(error.message, true); }
}

function loadProjectData(project) {
  document.getElementById('titleInput').value = project.title || '';
  characters = Array.isArray(project.characters) ? [...project.characters] : characters;
  blocks = Array.isArray(project.blocks) ? [...project.blocks] : blocks;
  collaboration = project.collaboration || collaboration;
  document.getElementById('collaborationMode').value = collaboration.mode;
  renderChips();
  renderBlocks();
  updateModeSummary();
}

// KEYBOARD
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); addBlock(); }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveCurrentStory(); }
  if (e.key === 'Escape') { closeModal(); closeVault(); if (editMode) toggleEditMode(); }
  if (e.key === 'Delete' && editMode && selectedBlocks.size > 0) {
    blocks = blocks.filter(b => !selectedBlocks.has(b.id));
    selectedBlocks.clear();
    renderBlocks();
  }
});

// INIT
renderChips();
renderBlocks();
loadCapabilities();
updateModeSummary();
