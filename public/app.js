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
let currentStoryId = null;

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
  
  document.getElementById('lastTag').innerHTML = `<code>${tag}</code> inserted`;
  
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
  document.getElementById('lastTag').innerHTML = '<code>---</code> scene break inserted';
}

// CHIPS
function renderChips() {
  const bar = document.getElementById('charBar');
  const chips = characters.map(c => `
    <div class="char-chip ${selectedChar === c.name ? 'active' : ''}" 
         style="border-color: ${selectedChar === c.name ? c.color : ''}; box-shadow: ${selectedChar === c.name ? '0 0 16px ' + c.color + '33' : ''}"
         onclick="selectChar('${c.name}')">
      <span class="dot" style="background:${c.color}"></span>
      ${c.name}
      <span class="remove" onclick="event.stopPropagation();removeChar('${c.name}')">✕</span>
    </div>
  `).join('');
  bar.innerHTML = `<div class="char-bar-title">Cast</div>${chips}<button class="add-char-btn" onclick="openModal()">+ Char</button>`;
}

// BLOCKS
function renderBlocks() {
  const editor = document.getElementById('editor');
  const empty = document.getElementById('emptyState');
  const nonEmpty = blocks.filter(b => b.text || b.char);
  
  if (nonEmpty.length === 0) {
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
      html += `<div class="separator"><span class="diamond">◆</span> ${prevBlock.char} → ${block.char} <span class="diamond">◆</span></div>`;
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
          ? `<div class="block-label" style="color:${color}">${block.char}</div>` 
          : `<div class="unassigned-label">Unassigned</div>`}
        <textarea placeholder="Type dialogue..." 
                  oninput="updateText(${block.id}, this.value); autoResize(this)"
                  onclick="event.stopPropagation()"
                  onfocus="activeTextarea = this">${block.text}</textarea>
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
  const seconds = Math.round((totalChars / 150) * 60);
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
    block.text = text;
    const el = document.querySelector(`.block[data-id="${id}"]`);
    if (el) {
      const count = text.length;
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
  if (name && !characters.find(c => c.name === name)) {
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

function saveCurrentStory() {
  const title = document.getElementById('titleInput').value || 'Untitled';
  const story = {
    id: currentStoryId || Date.now().toString(),
    title,
    model: document.getElementById('modelSelect').value,
    characters: [...characters],
    blocks: [...blocks],
    customTags: [...customTags],
    nextId,
    savedAt: new Date().toISOString(),
    duration: document.getElementById('durationEst').textContent,
    totalChars: blocks.reduce((sum, b) => sum + b.text.length, 0)
  };
  
  const stories = getStories();
  const existing = stories.findIndex(s => s.id === story.id);
  if (existing >= 0) stories[existing] = story;
  else stories.unshift(story);
  
  saveStories(stories);
  currentStoryId = story.id;
  renderVaultList();
  
  document.getElementById('lastTag').innerHTML = `<code>${title}</code> saved ✓`;
}

function loadStory(id) {
  const stories = getStories();
  const story = stories.find(s => s.id === id);
  if (!story) return;
  
  currentStoryId = story.id;
  document.getElementById('titleInput').value = story.title;
  document.getElementById('modelSelect').value = story.model;
  characters = [...story.characters];
  blocks = [...story.blocks];
  customTags = story.customTags || [];
  nextId = story.nextId || blocks.length + 1;
  
  // Rebuild custom tag buttons
  const grid = document.getElementById('tagGrid');
  grid.querySelectorAll('.tag-btn').forEach(btn => {
    if (customTags.includes(btn.textContent)) btn.remove();
  });
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

function deleteStory(id, e) {
  e.stopPropagation();
  const stories = getStories().filter(s => s.id !== id);
  saveStories(stories);
  if (currentStoryId === id) currentStoryId = null;
  renderVaultList();
}

function newStory() {
  currentStoryId = null;
  document.getElementById('titleInput').value = '';
  characters = [
    { name: 'Nova', color: '#39ff14' },
    { name: 'Aria', color: '#00ccff' }
  ];
  blocks = [{ id: 1, text: '', char: null }];
  customTags = [];
  nextId = 2;
  
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
      <div class="vault-item ${s.id === currentStoryId ? 'active' : ''}" onclick="loadStory('${s.id}')">
        <span class="vault-item-delete" onclick="deleteStory('${s.id}', event)">✕</span>
        <div class="vault-item-title">${s.title || 'Untitled'}</div>
        <div class="vault-item-meta">
          <span>${dateStr} ${timeStr}</span>
          <span class="chars">${s.totalChars || 0} chars</span>
          <span>${s.duration || '0:00'}</span>
        </div>
        <div class="vault-item-chars">
          ${s.characters.map(c => `<span class="vault-item-char" style="border-color:${c.color};color:${c.color}">${c.name}</span>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function openVault() {
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
