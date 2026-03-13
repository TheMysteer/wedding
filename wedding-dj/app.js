/* ══════════════════════════════════════════════
   WEDDING DJ — app.js
   ══════════════════════════════════════════════ */

// Extensões de áudio aceitas
const AUDIO_EXTS = /\.(mp3|m4a|wav|ogg|aac|flac|opus|mpeg|mpg|mp2|wma)$/i;

// ──────────────────────────────────────────────
//  ESTADO GLOBAL
// ──────────────────────────────────────────────
const state = {
  // Faixas de cada playlist: [{ name, url, dur, id }]
  playlists: {
    entrada: [],
    fundo: [],
  },

  // Configurações independentes de cada painel
  // autoNext  → ao terminar, toca a próxima automaticamente
  // shuffle   → próxima é escolhida aleatoriamente
  // repeat    → ao terminar a última, volta para a primeira
  // repeatOne → fica repetindo a mesma música
  settings: {
    entrada: { autoNext: false, shuffle: false, repeat: false, repeatOne: false },
    fundo: { autoNext: false, shuffle: false, repeat: false, repeatOne: false },
  },

  active: 'entrada', // painel/playlist atualmente no player
  idx: -1,        // índice da faixa atual
  playing: false,
  seeking: false,
};

// ──────────────────────────────────────────────
//  ELEMENTO DE ÁUDIO
// ──────────────────────────────────────────────
const audio = new Audio();
audio.volume = 0.85;
audio.preload = 'metadata';

// ──────────────────────────────────────────────
//  WEB AUDIO API — DETECÇÃO DE SILÊNCIO
// ──────────────────────────────────────────────
// Inicializado no primeiro interact (gesture), pois AudioContext requer isso.
let audioCtx = null;
let analyser = null;
let audioSource = null; // MediaElementSource (criado apenas 1x)

// Estado da detecção de silêncio
const silence = {
  silentSince: null,   // timestamp (ms) de quando o silêncio começou
  triggered: false,  // se já mandou nextTrack() para esta faixa
  THRESHOLD: 0.015,  // volume RMS abaixo disso = silêncio (0–1 escala)
  MIN_DURATION: 200,   // ms de silêncio contínuo antes de trocar
  TAIL_FRACTION: 0.70,   // só monitora a partir deste % da música (ex: 70%)
  MIN_ABS_REMAIN: 8,    // não monitora se restar mais de N segundos (segurança)
};

function initAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.3;
  // Conecta o <audio> element ao analyser → destination
  audioSource = audioCtx.createMediaElementSource(audio);
  audioSource.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function getRMS() {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function resetSilenceDetection() {
  silence.silentSince = null;
  silence.triggered = false;
}

function checkSilence() {
  if (!analyser) return;
  if (!state.playing) return;
  if (state.seeking) return;
  if (silence.triggered) return;

  const dur = audio.duration;
  const cur = audio.currentTime;
  if (!dur || !isFinite(dur) || dur <= 0) return;

  // Só activa na parte final da música
  const remaining = dur - cur;
  const fraction = cur / dur;
  if (fraction < silence.TAIL_FRACTION && remaining > silence.MIN_ABS_REMAIN) return;

  const cfg = state.settings[state.active];
  // Só faz algo se autoNext (ou opções equivalentes) estiver ligado
  if (!cfg.autoNext && !cfg.repeat && !cfg.repeatOne && !cfg.shuffle) return;
  // repeatOne não precisa de detecção: o evento ended já reinicia
  if (cfg.repeatOne) return;

  const track = state.playlists[state.active]?.[state.idx];
  if (track?.repeat) return; // repetição por faixa: deixa o ended cuidar

  const rms = getRMS();

  if (rms < silence.THRESHOLD) {
    if (silence.silentSince === null) {
      silence.silentSince = performance.now();
    } else {
      const elapsed = performance.now() - silence.silentSince;
      if (elapsed >= silence.MIN_DURATION) {
        silence.triggered = true;
        nextTrack(false);
      }
    }
  } else {
    // Som detectado: reseta contador
    silence.silentSince = null;
  }
}

// ──────────────────────────────────────────────
//  BANCO DE DADOS PARA CACHE OFFLINE
// ──────────────────────────────────────────────
const DB_NAME = 'weddingdj';
const STORE = 'tracks';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function saveTrackToDB(track, pl) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...track, pl });
    return tx.complete;
  } catch (e) { console.warn('DB save failed', e); }
}

async function deleteTrackFromDB(id) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    return tx.complete;
  } catch (e) { console.warn('DB delete failed', e); }
}

async function clearPlaylistDB(pl) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.openCursor().onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.pl === pl) store.delete(cursor.key);
        cursor.continue();
      }
    };
    return tx.complete;
  } catch (e) { console.warn('DB clear playlist failed', e); }
}

async function getAllStoredTracks() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE);
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  } catch (e) { console.warn('DB getAll failed', e); return []; }
}

// restore tracks that were previously added from IndexedDB
async function restoreFromDB() {
  const stored = await getAllStoredTracks();
  if (!stored.length) return;
  stored.forEach(entry => {
    // create a fresh object in state, converting file -> URL
    const url = URL.createObjectURL(entry.file);
    state.playlists[entry.pl].push({
      name: entry.name,
      url,
      dur: entry.dur || null,
      id: entry.id,
      repeat: entry.repeat || false,
      file: entry.file, // keep for future saves
    });
  });
  renderAll();
  updateBadge('entrada');
  updateBadge('fundo');
  preloadDurations('entrada');
  preloadDurations('fundo');
}

// ──────────────────────────────────────────────
//  INICIALIZAÇÃO
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindFileInputs();
  bindPlayerControls();
  bindPanelSettings();
  bindKeyboard();
  updatePlayerUI();
  updatePanelHighlight();
  restoreFromDB();
});

// ──────────────────────────────────────────────
//  BIND: INPUTS DE ARQUIVO / PASTA
// ──────────────────────────────────────────────
function bindFileInputs() {
  const pairs = [
    ['fileEntrada', 'entrada'],
    ['fileFundo', 'fundo'],
    ['folderEntrada', 'entrada'],
    ['folderFundo', 'fundo'],
  ];
  pairs.forEach(([id, pl]) => {
    document.getElementById(id).addEventListener('change', e => {
      loadFiles(pl, e.target.files);
      e.target.value = '';
    });
  });
}

// ──────────────────────────────────────────────
//  BIND: CONTROLES DO PLAYER (barra inferior)
// ──────────────────────────────────────────────
function bindPlayerControls() {
  document.getElementById('btnPlay').addEventListener('click', togglePlay);
  // always force previous when user clicks button, ignore 3s restart rule
  document.getElementById('btnPrev').addEventListener('click', () => prevTrack(true));
  document.getElementById('btnNext').addEventListener('click', () => nextTrack(true));
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
  document.getElementById('btnZoomIn').addEventListener('click', increaseZoom);
  document.getElementById('btnZoomOut').addEventListener('click', decreaseZoom);

  // novos controles junto ao player
  document.getElementById('btnEntrada').addEventListener('click', () => activatePlaylist('entrada'));
  document.getElementById('btnRepeat').addEventListener('click', toggleRepeat);
  document.getElementById('btnRepeatOne').addEventListener('click', toggleRepeatOne);
  document.getElementById('btnFundo').addEventListener('click', () => activatePlaylist('fundo'));

  document.getElementById('btnActivateEntrada').addEventListener('click', () => activatePlaylist('entrada'));
  document.getElementById('btnActivateFundo').addEventListener('click', () => activatePlaylist('fundo'));
  document.getElementById('btnClearEntrada').addEventListener('click', () => clearPlaylist('entrada'));
  document.getElementById('btnClearFundo').addEventListener('click', () => clearPlaylist('fundo'));

  // Barra de progresso
  const pi = document.getElementById('progressInput');
  let wasPlayingBeforeSeek = false;

  pi.addEventListener('mousedown', () => {
    state.seeking = true;
    wasPlayingBeforeSeek = state.playing;
    if (state.playing) audio.pause();
  });
  pi.addEventListener('touchstart', () => {
    state.seeking = true;
    wasPlayingBeforeSeek = state.playing;
    if (state.playing) audio.pause();
  }, { passive: true });

  pi.addEventListener('input', () => {
    if (audio.duration && isFinite(audio.duration)) {
      audio.currentTime = (pi.value / 1000) * audio.duration;
    }
    // Update UI immediately while dragging/seeking, even when paused
    updateProgressUI();
  });

  pi.addEventListener('mouseup', () => {
    state.seeking = false;
    resetSilenceDetection(); // posição mudou: reinicia contador de silêncio
    updateProgressUI(); // ensure UI is updated
    if (wasPlayingBeforeSeek && audio.paused) audio.play().catch(() => { });
  });
  pi.addEventListener('touchend', () => {
    state.seeking = false;
    resetSilenceDetection(); // posição mudou: reinicia contador de silêncio
    updateProgressUI(); // ensure UI is updated
    if (wasPlayingBeforeSeek && audio.paused) audio.play().catch(() => { });
  });

  // Volume
  document.getElementById('volSlider').addEventListener('input', e => {
    audio.volume = e.target.value / 100;
  });
}

// ──────────────────────────────────────────────
//  BIND: BOTÕES DE CONFIGURAÇÃO POR PAINEL
// ──────────────────────────────────────────────
function bindPanelSettings() {
  // Seleciona todos os botões .pbtn que têm data-pl e data-key
  document.querySelectorAll('.pbtn[data-pl][data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pl = btn.dataset.pl;
      const key = btn.dataset.key;
      const cfg = state.settings[pl];

      // Regra de exclusividade:
      // repeatOne desliga repeat (e vice-versa)
      // shuffle desliga repeatOne
      if (key === 'repeatOne' && !cfg.repeatOne) cfg.repeat = false;
      if (key === 'repeat' && !cfg.repeat) cfg.repeatOne = false;
      if (key === 'shuffle' && !cfg.shuffle) cfg.repeatOne = false;

      // Alterna o estado
      cfg[key] = !cfg[key];

      // Se autoNext foi desligado, desliga também shuffle e repeat/repeatOne
      // (não faz sentido shuffle sem autonext)
      if (key === 'autoNext' && !cfg.autoNext) {
        cfg.shuffle = false;
        cfg.repeat = false;
        cfg.repeatOne = false;
      }

      // Se shuffle, repeat ou repeatOne foi ligado, liga autonext automaticamente
      if (['shuffle', 'repeat', 'repeatOne'].includes(key) && cfg[key]) {
        cfg.autoNext = true;
      }

      updatePanelSettingsUI(pl);
      showSettingsToast(pl, key, cfg[key]);
    });
  });
}

// Atualiza a aparência visual dos botões de configuração de um painel
function updatePanelSettingsUI(pl) {
  const cfg = state.settings[pl];
  const keys = ['autoNext', 'shuffle', 'repeat', 'repeatOne'];
  const idMap = {
    autoNext: `ps-${pl}-autonext`,
    shuffle: `ps-${pl}-shuffle`,
    repeat: `ps-${pl}-repeat`,
    repeatOne: `ps-${pl}-repeatone`,
  };
  keys.forEach(key => {
    const el = document.getElementById(idMap[key]);
    if (el) el.classList.toggle('on', !!cfg[key]);
  });
}

function showSettingsToast(pl, key, on) {
  const plLabel = pl === 'entrada' ? 'Entrada & Saída' : 'Fundo';
  const labels = {
    autoNext: on ? `[${plLabel}] Próxima automática ligada` : `[${plLabel}] Próxima automática desligada`,
    shuffle: on ? `[${plLabel}] Aleatório ligado` : `[${plLabel}] Aleatório desligado`,
    repeat: on ? `[${plLabel}] Repetir tudo ligado` : `[${plLabel}] Repetir tudo desligado`,
    repeatOne: on ? `[${plLabel}] Repetir uma música ligado` : `[${plLabel}] Repetir uma música desligado`,
  };
  showToast(labels[key] || '');
}

// ──────────────────────────────────────────────
//  BIND: ATALHOS DE TECLADO
// ──────────────────────────────────────────────
function bindKeyboard() {
  document.addEventListener('keydown', e => {
    const active = document.activeElement;
    const tag = active.tagName;
    // ignore typing fields, but allow space when focus is on the progress slider
    if ((tag === 'INPUT' && active.id !== 'progressInput' && active.id !== 'volSlider') || tag === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight' && e.altKey) {
      e.preventDefault();
      nextTrack(true);
    } else if (e.code === 'ArrowLeft' && e.altKey) {
      e.preventDefault();
      prevTrack();
    }
  });
}

// ──────────────────────────────────────────────
//  CARREGAR ARQUIVOS
// ──────────────────────────────────────────────
function loadFiles(pl, files) {
  const all = Array.from(files);
  const accepted = all.filter(f =>
    f.type.startsWith('audio/') || AUDIO_EXTS.test(f.name)
  );
  const rejected = all.length - accepted.length;

  if (!accepted.length) {
    showToast('Nenhum arquivo de áudio reconhecido.');
    return;
  }

  // Ordena por nome (natural, ex: 01, 02, 10...)
  accepted.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));

  accepted.forEach(f => {
    const track = {
      name: f.name.replace(/\.[^/.]+$/, ''),
      url: URL.createObjectURL(f),
      dur: null,
      id: uniqueId(),
      repeat: false, // per-track repeat flag
      file: f,
    };
    state.playlists[pl].push(track);
    saveTrackToDB(track, pl);
  });

  renderList(pl);
  updateBadge(pl);
  preloadDurations(pl);

  const label = pl === 'entrada' ? 'Entrada & Saída' : 'Fundo';
  let msg = `${accepted.length} música${accepted.length > 1 ? 's' : ''} adicionada${accepted.length > 1 ? 's' : ''} em "${label}"`;
  if (rejected > 0) msg += ` (${rejected} ignorada${rejected > 1 ? 's' : ''})`;
  showToast(msg);
}

function preloadDurations(pl) {
  state.playlists[pl].forEach((track, i) => {
    if (track.dur !== null) return;
    const tmp = new Audio();
    tmp.preload = 'metadata';
    tmp.src = track.url;
    tmp.addEventListener('loadedmetadata', () => {
      track.dur = tmp.duration;
      const cell = document.querySelector(`#list${cap(pl)} [data-idx="${i}"] .track-dur`);
      if (cell) cell.textContent = fmtTime(tmp.duration);
      tmp.src = '';
    }, { once: true });
  });
}

// ──────────────────────────────────────────────
//  RENDERIZAR LISTA
// ──────────────────────────────────────────────
function renderList(pl) {
  const el = document.getElementById('list' + cap(pl));
  const tracks = state.playlists[pl];
  const isActive = state.active === pl;

  if (!tracks.length) {
    el.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">${pl === 'entrada' ? '🎊' : '🎶'}</span>
        Nenhuma música adicionada.<br>
        Use <b>＋ Arquivos</b> para selecionar arquivos<br>
        ou <b>📁 Pasta</b> para carregar uma pasta inteira.
      </div>`;
    return;
  }

  el.innerHTML = tracks.map((t, i) => {
    const isCurrent = isActive && state.idx === i;
    const isPaused = isCurrent && !state.playing;
    const dur = t.dur !== null ? fmtTime(t.dur) : '—';

    // choose play icon based on current/playing
    const playIcon = isCurrent && state.playing ? '⏸' : '▶';
    const repeatClass = t.repeat ? ' on' : '';

    return `
      <div class="track-row${isCurrent ? ' current' : ''}${isPaused ? ' paused' : ''}"
           data-pl="${pl}" data-idx="${i}"
           ondblclick="toggleTrack('${pl}', ${i})">
        <span class="track-idx">${i + 1}</span>
        <div class="wave-anim"><span></span><span></span><span></span><span></span></div>
        <div class="track-meta">
          <div class="track-name" title="${esc(t.name)}">${esc(t.name)}</div>
        </div>
        <span class="track-dur">${dur}</span>
        <div class="track-btns">
          <button class="tb play" title="Play/Pause"
            onclick="toggleTrack('${pl}', ${i}); event.stopPropagation();">${playIcon}</button>
          <button class="tb repeat${repeatClass}" title="Repetir faixa"
            onclick="toggleTrackRepeat('${pl}', ${i}); event.stopPropagation();">↺</button>
          <button class="tb del" title="Remover"
            onclick="removeTrack('${pl}', ${i}); event.stopPropagation();">✕</button>
        </div>
      </div>`;
  }).join('');
}

function renderAll() {
  renderList('entrada');
  renderList('fundo');
}

function updateBadge(pl) {
  const n = state.playlists[pl].length;
  document.getElementById('badge' + cap(pl)).textContent = n === 1 ? '1 música' : `${n} músicas`;
}

function updatePanelHighlight() {
  document.getElementById('panelEntrada').classList.toggle('active', state.active === 'entrada');
  document.getElementById('panelFundo').classList.toggle('active', state.active === 'fundo');
}

// ──────────────────────────────────────────────
//  REPRODUÇÃO
// ──────────────────────────────────────────────
function playTrack(pl, i) {
  const tracks = state.playlists[pl];
  if (!tracks || !tracks[i]) return;

  const isSameTrack = state.active === pl && state.idx === i;

  if (state.active !== pl) {
    state.active = pl;
    updatePanelHighlight();
    updatePanelSettingsUI('entrada');
    updatePanelSettingsUI('fundo');
  }

  state.idx = i;
  state.playing = true;

  // Inicializa AudioContext no primeiro play (requer gesto do usuário)
  initAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  // Reseta detecção de silêncio para a nova faixa
  resetSilenceDetection();

  // always pause before switching source to avoid some browsers ignoring the new src
  audio.pause();
  if (!isSameTrack) {
    audio.src = tracks[i].url;
  }
  audio.currentTime = 0;

  const p = audio.play();
  if (p) p.catch(err => {
    console.warn('Erro ao reproduzir:', err);
    state.playing = false;
    updatePlayerUI();
    renderAll();
  });

  updatePlayerUI();
  renderAll();
  scrollToCurrent(pl);
}

// toggle playback for a specific track row
function toggleTrack(pl, i) {
  if (state.active === pl && state.idx === i) {
    togglePlay();
  } else {
    playTrack(pl, i);
  }
}

function toggleTrackRepeat(pl, i) {
  const track = state.playlists[pl]?.[i];
  if (!track) return;
  track.repeat = !track.repeat;
  renderList(pl);
  const label = pl === 'entrada' ? 'Entrada & Saída' : 'Fundo';
  showToast(`[${label}] "${track.name}" repetição ${track.repeat ? 'ligada' : 'desligada'}`);
}

function activatePlaylist(pl) {
  // do not set state.active here – playTrack will handle the switch and avoid
  // confusing "isSameTrack" checks when both playlists happen to have a track
  // at the same index. previously we updated active before calling playTrack,
  // causing a false positive and the source URL would not change, so the audio
  // kept playing the last playlist.

  const tracks = state.playlists[pl];
  if (!tracks.length) { showToast('Adicione músicas antes de ativar.'); return; }

  const cfg = state.settings[pl];
  const startIdx = cfg.shuffle ? randomIdx(pl) : 0;
  playTrack(pl, startIdx);
}

function togglePlay() {
  if (state.idx === -1 || !audio.src) {
    const tracks = state.playlists[state.active];
    if (tracks.length) {
      const cfg = state.settings[state.active];
      playTrack(state.active, cfg.shuffle ? randomIdx(state.active) : 0);
    } else {
      showToast('Adicione músicas e clique em Ativar.');
    }
    return;
  }

  if (state.playing) {
    audio.pause();
  } else {
    const p = audio.play();
    if (p) p.catch(err => console.warn('Erro ao retomar:', err));
  }
}

// nextTrack:
//   forced = true  → chamado pelo botão ⏭ (ignora repeatOne)
//   forced = false → chamado pelo evento 'ended'
function nextTrack(forced = false) {
  const tracks = state.playlists[state.active];
  if (!tracks.length) return;

  const cfg = state.settings[state.active];

  // Repetir uma música (só quando não for forçado pelo botão)
  if (!forced && cfg.repeatOne) {
    audio.currentTime = 0;
    audio.play().catch(() => { });
    return;
  }

  let next;

  if (cfg.shuffle) {
    // Aleatório
    next = randomIdx(state.active);
  } else {
    next = state.idx + 1;
    if (next >= tracks.length) {
      if (cfg.repeat) {
        // Volta para o início
        next = 0;
      } else {
        // Fim da playlist
        state.playing = false;
        updatePlayerUI();
        renderAll();
        showToast('Fim da playlist.');
        return;
      }
    }
  }

  playTrack(state.active, next);
}

function prevTrack(force = false) {
  const tracks = state.playlists[state.active];
  if (!tracks.length) return;

  // if not forced and more than 3s into current track, restart it
  if (!force && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  const cfg = state.settings[state.active];
  let prev;

  if (cfg.shuffle) {
    prev = randomIdx(state.active);
  } else {
    prev = state.idx - 1;
    if (prev < 0) prev = Math.max(tracks.length - 1, 0);
  }

  playTrack(state.active, prev);
}

function removeTrack(pl, i) {
  const wasCurrent = state.active === pl && state.idx === i;
  const track = state.playlists[pl][i];
  URL.revokeObjectURL(track.url);
  state.playlists[pl].splice(i, 1);
  deleteTrackFromDB(track.id);

  if (wasCurrent) {
    audio.pause();
    audio.src = '';
    state.playing = false;
    state.idx = -1;
    updatePlayerUI();
  } else if (state.active === pl && state.idx > i) {
    state.idx--;
  }

  renderList(pl);
  updateBadge(pl);
}

// novos controles: repetição e alternância de playlist
function toggleRepeat() {
  const pl = state.active;
  const cfg = state.settings[pl];
  cfg.repeat = !cfg.repeat;
  // exclusão de repeatOne se necessário
  if (cfg.repeat && cfg.repeatOne) cfg.repeatOne = false;
  // repetir tudo liga autoNext
  if (cfg.repeat) cfg.autoNext = true;
  updatePanelSettingsUI(pl);
  showSettingsToast(pl, 'repeat', cfg.repeat);
}

function toggleRepeatOne() {
  const pl = state.active;
  const cfg = state.settings[pl];
  cfg.repeatOne = !cfg.repeatOne;
  if (cfg.repeatOne && cfg.repeat) cfg.repeat = false;
  if (cfg.repeatOne) cfg.autoNext = true;
  updatePanelSettingsUI(pl);
  showSettingsToast(pl, 'repeatOne', cfg.repeatOne);
}

function clearPlaylist(pl) {
  if (!state.playlists[pl].length) return;
  const label = pl === 'entrada' ? 'Entrada & Saída' : 'Fundo';
  if (!confirm(`Remover todas as músicas de "${label}"?`)) return;

  state.playlists[pl].forEach(t => URL.revokeObjectURL(t.url));
  state.playlists[pl] = [];
  clearPlaylistDB(pl);

  if (state.active === pl) {
    audio.pause();
    audio.src = '';
    state.playing = false;
    state.idx = -1;
    updatePlayerUI();
  }

  renderList(pl);
  updateBadge(pl);
  showToast(`Playlist "${label}" limpa.`);
}

function moveTrack(fromPl, i, toPl) {
  const track = state.playlists[fromPl][i];
  const wasCurrent = state.active === fromPl && state.idx === i;

  state.playlists[fromPl].splice(i, 1);
  state.playlists[toPl].push(track);

  if (wasCurrent) {
    state.active = toPl;
    state.idx = state.playlists[toPl].length - 1;
    updatePanelHighlight();
    audio.src = track.url;
    audio.play().catch(() => { });
    updatePlayerUI();
  } else if (state.active === fromPl && state.idx > i) {
    state.idx--;
  }

  renderList(fromPl);
  renderList(toPl);
  updateBadge(fromPl);
  updateBadge(toPl);

  const toLabel = toPl === 'entrada' ? 'Entrada & Saída' : 'Fundo';
  showToast(`"${track.name}" movida para ${toLabel}`);
}

// ──────────────────────────────────────────────
//  EVENTOS DO ÁUDIO
// ──────────────────────────────────────────────
audio.addEventListener('play', () => {
  state.playing = true;
  document.getElementById('btnPlay').textContent = '⏸';
  renderAll();
});

audio.addEventListener('pause', () => {
  state.playing = false;
  document.getElementById('btnPlay').textContent = '▶';
  renderAll();
});

audio.addEventListener('ended', () => {
  // check track-specific repeat first
  const track = state.playlists[state.active]?.[state.idx];
  if (track?.repeat) {
    audio.currentTime = 0;
    audio.play().catch(() => { });
    return;
  }

  const cfg = state.settings[state.active];

  // Qualquer das opções de continuidade → nextTrack decide o comportamento
  if (cfg.autoNext || cfg.repeat || cfg.repeatOne || cfg.shuffle) {
    nextTrack(false);
  } else {
    state.playing = false;
    document.getElementById('btnPlay').textContent = '▶';
    renderAll();
  }
});

audio.addEventListener('loadedmetadata', () => {
  if (!isFinite(audio.duration)) return;
  document.getElementById('timeTotal').textContent = fmtTime(audio.duration);

  const track = state.playlists[state.active][state.idx];
  if (track) {
    track.dur = audio.duration;
    const cell = document.querySelector(
      `#list${cap(state.active)} [data-idx="${state.idx}"] .track-dur`
    );
    if (cell) cell.textContent = fmtTime(audio.duration);
  }
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration || !isFinite(audio.duration)) return;
  updateProgressUI();
  checkSilence();
});

audio.addEventListener('error', () => {
  const err = audio.error;
  let msg = 'Erro ao reproduzir este arquivo.';
  if (err?.code === 4) msg = 'Formato não suportado neste navegador. Tente o Edge ou converta para MP3.';
  if (err?.code === 2) msg = 'Erro ao carregar o arquivo.';
  showToast(msg);
  state.playing = false;
  document.getElementById('btnPlay').textContent = '▶';
  renderAll();
});

// ──────────────────────────────────────────────
//  TEMA & ZOOM
// ──────────────────────────────────────────────
let darkMode = true;
let zoomLevel = 1; // 1.0 = normal, can range e.g. 0.5–2.0

function applyZoom() {
  // zoom property has decent support and scales everything including px
  document.body.style.zoom = zoomLevel;
  localStorage.setItem('zoom', zoomLevel);
}
function increaseZoom() {
  zoomLevel = Math.min(2, zoomLevel + 0.1);
  applyZoom();
  showToast(`Zoom: ${Math.round(zoomLevel * 100)}%`);
}
function decreaseZoom() {
  zoomLevel = Math.max(0.5, zoomLevel - 0.1);
  applyZoom();
  showToast(`Zoom: ${Math.round(zoomLevel * 100)}%`);
}

/* start in dark mode by default */
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.setAttribute('data-theme', 'dark');
  const btn = document.getElementById('btnTheme');
  if (btn) btn.textContent = '☀️';

  // restore zoom preference
  const storedZ = parseFloat(localStorage.getItem('zoom'));
  if (!isNaN(storedZ)) zoomLevel = storedZ;
  applyZoom();
});
function toggleTheme() {
  darkMode = !darkMode;
  document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  document.getElementById('btnTheme').textContent = darkMode ? '☀️' : '🌙';
}

// ──────────────────────────────────────────────
//  ATUALIZAR UI DO PLAYER
// ──────────────────────────────────────────────
function updateProgressUI() {
  if (!audio.duration || !isFinite(audio.duration)) return;
  const pct = audio.currentTime / audio.duration;

  document.getElementById('progressFill').style.width = (pct * 100).toFixed(2) + '%';
  document.getElementById('progressThumb').style.left = (pct * 100).toFixed(2) + '%';
  document.getElementById('progressInput').value = Math.round(pct * 1000);
  document.getElementById('timeNow').textContent = fmtTime(audio.currentTime);
}

function updatePlayerUI() {
  const track = state.playlists[state.active][state.idx];
  const nameEl = document.getElementById('nowName');
  const srcEl = document.getElementById('nowSource');
  const playBtn = document.getElementById('btnPlay');

  if (track) {
    nameEl.textContent = track.name;
    const total = state.playlists[state.active].length;
    const plLabel = state.active === 'entrada' ? '🎊 Entrada &amp; Saída' : '🎶 Fundo';
    srcEl.innerHTML = `Playlist: <b>${plLabel}</b> &nbsp;·&nbsp; Faixa ${state.idx + 1} de ${total}`;
  } else {
    nameEl.innerHTML = '<em>Nenhuma música selecionada</em>';
    srcEl.innerHTML = 'Escolha uma playlist e clique em <b>Ativar</b>';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressThumb').style.left = '0%';
    document.getElementById('progressInput').value = 0;
    document.getElementById('timeNow').textContent = '0:00';
    document.getElementById('timeTotal').textContent = '0:00';
  }

  playBtn.textContent = state.playing ? '⏸' : '▶';

  // update left/right/player-aux buttons
  const btnEntrada = document.getElementById('btnEntrada');
  const btnFundo = document.getElementById('btnFundo');
  const btnRepeat = document.getElementById('btnRepeat');
  const btnRepeatOne = document.getElementById('btnRepeatOne');

  // highlight active playlist button
  if (btnEntrada && btnFundo) {
    btnEntrada.classList.toggle('on', state.active === 'entrada');
    btnFundo.classList.toggle('on', state.active === 'fundo');
  }

  // repeat flags reflect current playlist settings
  const cfg = state.settings[state.active] || {};
  if (btnRepeat) btnRepeat.classList.toggle('on', !!cfg.repeat);
  if (btnRepeatOne) btnRepeatOne.classList.toggle('on', !!cfg.repeatOne);
}

// ──────────────────────────────────────────────
//  UTILITÁRIOS
// ──────────────────────────────────────────────
function fmtTime(sec) {
  if (!sec || !isFinite(sec) || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function randomIdx(pl) {
  const len = state.playlists[pl].length;
  if (len <= 1) return 0;
  let r;
  do { r = Math.floor(Math.random() * len); } while (r === state.idx);
  return r;
}

function uniqueId() {
  return Math.random().toString(36).slice(2, 9);
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function scrollToCurrent(pl) {
  requestAnimationFrame(() => {
    const row = document.querySelector(`#list${cap(pl)} .track-row.current`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}
