import './style.css';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const editorCanvas = $('#editorCanvas');
const editorCtx = editorCanvas.getContext('2d');
const viewport = $('#canvasViewport');
const sourceCanvas = document.createElement('canvas');
const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

const state = {
  loaded: false,
  originalBlob: null,
  fileName: 'manga',
  zoom: 1,
  panX: 0,
  panY: 0,
  tool: 'brush',
  pointerDown: false,
  lastPoint: null,
  rectStart: null,
  rectCurrent: null,
  panning: false,
  panStart: null,
  spacePressed: false,
  textObjects: [],
  selectedTextId: null,
  draggingText: false,
  dragOffset: null,
  direction: 'horizontal',
  bold: true,
  italic: false,
  align: 'left',
  dpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
  history: [],
  redo: [],
  historyTimer: null,
  historyQueue: Promise.resolve(),
  restoring: false,
};

const controls = {
  fileInput: $('#fileInput'),
  emptyState: $('#emptyState'),
  status: $('#statusText'),
  brushSize: $('#brushSize'),
  brushSizeValue: $('#brushSizeValue'),
  expandMask: $('#expandMask'),
  expandValue: $('#expandValue'),
  inpaintRadius: $('#inpaintRadius'),
  radiusValue: $('#radiusValue'),
  fillColor: $('#fillColor'),
  textContent: $('#textContent'),
  fontFamily: $('#fontFamily'),
  fontSize: $('#fontSize'),
  lineHeight: $('#lineHeight'),
  letterSpacing: $('#letterSpacing'),
  textBoxWidth: $('#textBoxWidth'),
  textColor: $('#textColor'),
  strokeColor: $('#strokeColor'),
  strokeWidth: $('#strokeWidth'),
  exportFormat: $('#exportFormat'),
  exportQuality: $('#exportQuality'),
  qualityValue: $('#qualityValue'),
  zoomLabel: $('#zoomLabel'),
  busyOverlay: $('#busyOverlay'),
  busyTitle: $('#busyTitle'),
  busyDetail: $('#busyDetail'),
  bgProgressWrap: $('#bgProgressWrap'),
  bgProgressBar: $('#bgProgressBar'),
  bgProgressText: $('#bgProgressText'),
};

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toastContainer').appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function setBusy(show, title = '正在處理圖片', detail = '請勿關閉頁面') {
  controls.busyTitle.textContent = title;
  controls.busyDetail.textContent = detail;
  controls.busyOverlay.classList.toggle('hidden', !show);
}

function setStatus(text) {
  controls.status.textContent = text;
}

function resizeEditorCanvas() {
  const rect = viewport.getBoundingClientRect();
  editorCanvas.width = Math.max(1, Math.floor(rect.width * state.dpr));
  editorCanvas.height = Math.max(1, Math.floor(rect.height * state.dpr));
  editorCanvas.style.width = `${rect.width}px`;
  editorCanvas.style.height = `${rect.height}px`;
  render();
}

function imageToScreen(x, y) {
  return { x: state.panX + x * state.zoom, y: state.panY + y * state.zoom };
}

function screenToImage(x, y) {
  return { x: (x - state.panX) / state.zoom, y: (y - state.panY) / state.zoom };
}

function clampZoom(value) {
  return Math.max(0.05, Math.min(8, value));
}

function setZoom(nextZoom, anchorX = viewport.clientWidth / 2, anchorY = viewport.clientHeight / 2) {
  if (!state.loaded) return;
  const before = screenToImage(anchorX, anchorY);
  state.zoom = clampZoom(nextZoom);
  state.panX = anchorX - before.x * state.zoom;
  state.panY = anchorY - before.y * state.zoom;
  controls.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  render();
}

function fitImage() {
  if (!state.loaded) return;
  const padding = 38;
  const w = Math.max(1, viewport.clientWidth - padding * 2);
  const h = Math.max(1, viewport.clientHeight - padding * 2);
  state.zoom = clampZoom(Math.min(w / sourceCanvas.width, h / sourceCanvas.height));
  state.panX = (viewport.clientWidth - sourceCanvas.width * state.zoom) / 2;
  state.panY = (viewport.clientHeight - sourceCanvas.height * state.zoom) / 2;
  controls.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  render();
}

function fontString(obj) {
  return `${obj.italic ? 'italic ' : ''}${obj.bold ? '700 ' : '400 '}${obj.fontSize}px ${obj.fontFamily}`;
}

function splitHorizontalLines(ctx, text, maxWidth, letterSpacing) {
  const paragraphs = String(text || '').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const char of [...paragraph]) {
      const candidate = line + char;
      const width = ctx.measureText(candidate).width + Math.max(0, candidate.length - 1) * letterSpacing;
      if (line && width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

function drawSpacedText(ctx, text, x, y, spacing, strokeFirst, obj) {
  let cursor = x;
  for (const char of [...text]) {
    if (strokeFirst && obj.strokeWidth > 0) ctx.strokeText(char, cursor, y);
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
}

function makeVerticalColumns(text, charsPerColumn) {
  const columns = [[]];
  for (const char of [...String(text || '').replace(/\r/g, '')]) {
    if (char === '\n') {
      if (columns[columns.length - 1].length || columns.length === 1) columns.push([]);
      continue;
    }
    if (columns[columns.length - 1].length >= charsPerColumn) columns.push([]);
    columns[columns.length - 1].push(char);
  }
  return columns.length ? columns : [[]];
}

function measureTextObject(ctx, obj) {
  ctx.save();
  ctx.font = fontString(obj);
  ctx.textBaseline = 'top';
  if (obj.direction === 'vertical') {
    const step = obj.fontSize * obj.lineHeight;
    const charsPerColumn = Math.max(1, Math.floor(obj.boxWidth / step));
    const columns = makeVerticalColumns(obj.text, charsPerColumn);
    const maxRows = Math.max(1, ...columns.map((column) => column.length));
    ctx.restore();
    return { x: obj.x, y: obj.y, width: columns.length * step, height: maxRows * step };
  }
  const lines = splitHorizontalLines(ctx, obj.text, obj.boxWidth, obj.letterSpacing);
  const height = lines.length * obj.fontSize * obj.lineHeight;
  ctx.restore();
  return { x: obj.x, y: obj.y, width: obj.boxWidth, height };
}

function drawTextObject(ctx, obj, selected = false) {
  ctx.save();
  ctx.font = fontString(obj);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.fillStyle = obj.color;
  ctx.strokeStyle = obj.strokeColor;
  ctx.lineWidth = obj.strokeWidth;

  if (obj.direction === 'vertical') {
    const step = obj.fontSize * obj.lineHeight;
    const charsPerColumn = Math.max(1, Math.floor(obj.boxWidth / step));
    const columns = makeVerticalColumns(obj.text, charsPerColumn);
    columns.forEach((column, columnIndex) => {
      const x = obj.x + (columns.length - 1 - columnIndex) * step + (step - obj.fontSize) / 2;
      column.forEach((char, rowIndex) => {
        const y = obj.y + rowIndex * step;
        if (obj.strokeWidth > 0) ctx.strokeText(char, x, y);
        ctx.fillText(char, x, y);
      });
    });
  } else {
    const lines = splitHorizontalLines(ctx, obj.text, obj.boxWidth, obj.letterSpacing);
    const lineStep = obj.fontSize * obj.lineHeight;
    lines.forEach((line, index) => {
      const measured = ctx.measureText(line).width + Math.max(0, line.length - 1) * obj.letterSpacing;
      let x = obj.x;
      if (obj.align === 'center') x += (obj.boxWidth - measured) / 2;
      if (obj.align === 'right') x += obj.boxWidth - measured;
      drawSpacedText(ctx, line, x, obj.y + index * lineStep, obj.letterSpacing, true, obj);
    });
  }

  if (selected) {
    const box = measureTextObject(ctx, obj);
    ctx.setLineDash([8 / state.zoom, 5 / state.zoom]);
    ctx.lineWidth = 1.5 / state.zoom;
    ctx.strokeStyle = '#8f7cff';
    ctx.fillStyle = 'rgba(143,124,255,.08)';
    ctx.fillRect(box.x - 5 / state.zoom, box.y - 5 / state.zoom, box.width + 10 / state.zoom, box.height + 10 / state.zoom);
    ctx.strokeRect(box.x - 5 / state.zoom, box.y - 5 / state.zoom, box.width + 10 / state.zoom, box.height + 10 / state.zoom);
  }
  ctx.restore();
}

function render() {
  const w = editorCanvas.width / state.dpr;
  const h = editorCanvas.height / state.dpr;
  editorCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  editorCtx.clearRect(0, 0, w, h);
  if (!state.loaded) return;

  editorCtx.save();
  editorCtx.translate(state.panX, state.panY);
  editorCtx.scale(state.zoom, state.zoom);
  editorCtx.imageSmoothingEnabled = state.zoom < 3;
  editorCtx.drawImage(sourceCanvas, 0, 0);
  editorCtx.globalAlpha = 0.55;
  editorCtx.drawImage(maskCanvas, 0, 0);
  editorCtx.globalAlpha = 1;

  for (const text of state.textObjects) {
    drawTextObject(editorCtx, text, text.id === state.selectedTextId);
  }

  if (state.rectStart && state.rectCurrent) {
    const x = Math.min(state.rectStart.x, state.rectCurrent.x);
    const y = Math.min(state.rectStart.y, state.rectCurrent.y);
    const rw = Math.abs(state.rectCurrent.x - state.rectStart.x);
    const rh = Math.abs(state.rectCurrent.y - state.rectStart.y);
    editorCtx.fillStyle = 'rgba(255,70,95,.2)';
    editorCtx.strokeStyle = '#ff546b';
    editorCtx.lineWidth = 2 / state.zoom;
    editorCtx.setLineDash([8 / state.zoom, 5 / state.zoom]);
    editorCtx.fillRect(x, y, rw, rh);
    editorCtx.strokeRect(x, y, rw, rh);
  }
  editorCtx.restore();
}

function eventPoint(event) {
  const rect = editorCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function isInsideImage(point) {
  return point.x >= 0 && point.y >= 0 && point.x <= sourceCanvas.width && point.y <= sourceCanvas.height;
}

function hitText(point) {
  for (let i = state.textObjects.length - 1; i >= 0; i -= 1) {
    const obj = state.textObjects[i];
    const box = measureTextObject(editorCtx, obj);
    if (point.x >= box.x - 8 && point.x <= box.x + box.width + 8 && point.y >= box.y - 8 && point.y <= box.y + box.height + 8) return obj;
  }
  return null;
}

function drawMaskLine(from, to, erase = false) {
  maskCtx.save();
  maskCtx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  maskCtx.strokeStyle = 'rgba(255,55,80,.94)';
  maskCtx.fillStyle = 'rgba(255,55,80,.94)';
  maskCtx.lineCap = 'round';
  maskCtx.lineJoin = 'round';
  maskCtx.lineWidth = Number(controls.brushSize.value);
  maskCtx.beginPath();
  maskCtx.moveTo(from.x, from.y);
  maskCtx.lineTo(to.x, to.y);
  maskCtx.stroke();
  if (from.x === to.x && from.y === to.y) {
    maskCtx.beginPath();
    maskCtx.arc(to.x, to.y, Number(controls.brushSize.value) / 2, 0, Math.PI * 2);
    maskCtx.fill();
  }
  maskCtx.restore();
}

function updateCursor() {
  if (state.spacePressed || state.tool === 'pan') editorCanvas.style.cursor = state.pointerDown ? 'grabbing' : 'grab';
  else if (state.tool === 'mask-eraser') editorCanvas.style.cursor = 'cell';
  else editorCanvas.style.cursor = 'crosshair';
}

editorCanvas.addEventListener('pointerdown', (event) => {
  if (!state.loaded || event.button !== 0) return;
  editorCanvas.setPointerCapture(event.pointerId);
  const screen = eventPoint(event);
  const point = screenToImage(screen.x, screen.y);

  if (state.spacePressed || state.tool === 'pan') {
    state.pointerDown = true;
    state.panning = true;
    state.panStart = { x: screen.x - state.panX, y: screen.y - state.panY };
    updateCursor();
    return;
  }

  const hit = hitText(point);
  if (hit) {
    state.selectedTextId = hit.id;
    syncTextControls(hit);
    state.draggingText = true;
    state.pointerDown = true;
    state.dragOffset = { x: point.x - hit.x, y: point.y - hit.y };
    render();
    return;
  }

  state.selectedTextId = null;
  state.pointerDown = true;
  if (!isInsideImage(point)) return;

  if (state.tool === 'rect') {
    state.rectStart = point;
    state.rectCurrent = point;
  } else if (state.tool === 'brush' || state.tool === 'mask-eraser') {
    state.lastPoint = point;
    drawMaskLine(point, point, state.tool === 'mask-eraser');
  }
  render();
});

editorCanvas.addEventListener('pointermove', (event) => {
  if (!state.pointerDown) return;
  const screen = eventPoint(event);
  const point = screenToImage(screen.x, screen.y);

  if (state.panning) {
    state.panX = screen.x - state.panStart.x;
    state.panY = screen.y - state.panStart.y;
  } else if (state.draggingText) {
    const obj = state.textObjects.find((item) => item.id === state.selectedTextId);
    if (obj) {
      obj.x = point.x - state.dragOffset.x;
      obj.y = point.y - state.dragOffset.y;
    }
  } else if (state.tool === 'rect' && state.rectStart) {
    state.rectCurrent = {
      x: Math.max(0, Math.min(sourceCanvas.width, point.x)),
      y: Math.max(0, Math.min(sourceCanvas.height, point.y)),
    };
  } else if ((state.tool === 'brush' || state.tool === 'mask-eraser') && state.lastPoint) {
    const clipped = {
      x: Math.max(0, Math.min(sourceCanvas.width, point.x)),
      y: Math.max(0, Math.min(sourceCanvas.height, point.y)),
    };
    drawMaskLine(state.lastPoint, clipped, state.tool === 'mask-eraser');
    state.lastPoint = clipped;
  }
  render();
});

async function finishPointerAction() {
  if (!state.pointerDown) return;
  let changed = false;
  if (state.tool === 'rect' && state.rectStart && state.rectCurrent) {
    const x = Math.min(state.rectStart.x, state.rectCurrent.x);
    const y = Math.min(state.rectStart.y, state.rectCurrent.y);
    const w = Math.abs(state.rectCurrent.x - state.rectStart.x);
    const h = Math.abs(state.rectCurrent.y - state.rectStart.y);
    if (w > 2 && h > 2) {
      maskCtx.fillStyle = 'rgba(255,55,80,.94)';
      maskCtx.fillRect(x, y, w, h);
      changed = true;
    }
  }
  if ((state.tool === 'brush' || state.tool === 'mask-eraser') && state.lastPoint) changed = true;
  if (state.draggingText) changed = true;

  state.pointerDown = false;
  state.panning = false;
  state.draggingText = false;
  state.lastPoint = null;
  state.rectStart = null;
  state.rectCurrent = null;
  updateCursor();
  render();
  if (changed) commitHistory();
}

editorCanvas.addEventListener('pointerup', finishPointerAction);
editorCanvas.addEventListener('pointercancel', finishPointerAction);

editorCanvas.addEventListener('wheel', (event) => {
  if (!state.loaded) return;
  event.preventDefault();
  const point = eventPoint(event);
  const factor = event.deltaY > 0 ? 0.9 : 1.1;
  setZoom(state.zoom * factor, point.x, point.y);
}, { passive: false });

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('無法建立圖片快照')), type, quality);
  });
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取圖片'));
    };
    img.src = url;
  });
}

async function captureSnapshot() {
  if (!state.loaded) return null;
  const [sourceBlob, maskBlob] = await Promise.all([
    canvasToBlob(sourceCanvas),
    canvasToBlob(maskCanvas),
  ]);
  return {
    sourceBlob,
    maskBlob,
    texts: structuredClone(state.textObjects),
    selectedTextId: state.selectedTextId,
  };
}

async function restoreSnapshot(snapshot) {
  if (!snapshot) return;
  state.restoring = true;
  const [sourceImage, maskImage] = await Promise.all([
    blobToImage(snapshot.sourceBlob),
    blobToImage(snapshot.maskBlob),
  ]);
  sourceCanvas.width = sourceImage.naturalWidth;
  sourceCanvas.height = sourceImage.naturalHeight;
  sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceCtx.drawImage(sourceImage, 0, 0);
  maskCanvas.width = sourceCanvas.width;
  maskCanvas.height = sourceCanvas.height;
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  maskCtx.drawImage(maskImage, 0, 0);
  state.textObjects = structuredClone(snapshot.texts);
  state.selectedTextId = snapshot.selectedTextId;
  syncTextControls(selectedText());
  state.restoring = false;
  render();
}

function commitHistory() {
  if (!state.loaded || state.restoring) return;
  clearTimeout(state.historyTimer);
  const capture = captureSnapshot();
  state.historyQueue = state.historyQueue.then(async () => {
    const snapshot = await capture;
    if (!snapshot) return;
    state.history.push(snapshot);
    if (state.history.length > 12) state.history.shift();
    state.redo = [];
    updateHistoryButtons();
  }).catch((error) => console.error(error));
}

function scheduleHistory() {
  clearTimeout(state.historyTimer);
  state.historyTimer = setTimeout(commitHistory, 500);
}

function updateHistoryButtons() {
  $('#undoBtn').disabled = state.history.length <= 1;
  $('#redoBtn').disabled = state.redo.length === 0;
}

async function flushScheduledHistory() {
  if (state.historyTimer) {
    clearTimeout(state.historyTimer);
    state.historyTimer = null;
    commitHistory();
  }
  await state.historyQueue;
}

async function undo() {
  await flushScheduledHistory();
  if (state.history.length <= 1) return;
  const current = state.history.pop();
  state.redo.push(current);
  await restoreSnapshot(state.history[state.history.length - 1]);
  updateHistoryButtons();
}

async function redo() {
  await flushScheduledHistory();
  if (!state.redo.length) return;
  const snapshot = state.redo.pop();
  state.history.push(snapshot);
  await restoreSnapshot(snapshot);
  updateHistoryButtons();
}

async function loadFile(file, preserveOriginal = false) {
  if (!file || !file.type.startsWith('image/')) {
    toast('請選擇 PNG、JPG 或 WEBP 圖片', 'error');
    return;
  }
  try {
    setBusy(true, '正在載入圖片', file.name || '剪貼簿圖片');
    const image = await blobToImage(file);
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceCtx.drawImage(image, 0, 0);
    maskCanvas.width = image.naturalWidth;
    maskCanvas.height = image.naturalHeight;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    state.loaded = true;
    state.textObjects = [];
    state.selectedTextId = null;
    state.history = [];
    state.redo = [];
    if (!preserveOriginal) state.originalBlob = file;
    state.fileName = (file.name || 'manga').replace(/\.[^.]+$/, '');
    controls.emptyState.classList.add('hidden');
    setStatus(`${sourceCanvas.width} × ${sourceCanvas.height}px`);
    fitImage();
    await state.historyQueue;
    commitHistory();
    toast('圖片已載入', 'success');
  } catch (error) {
    console.error(error);
    toast(error.message || '載入圖片失敗', 'error');
  } finally {
    setBusy(false);
  }
}

function selectedText() {
  return state.textObjects.find((item) => item.id === state.selectedTextId) || null;
}

function currentTextSettings() {
  return {
    text: controls.textContent.value || '輸入譯文',
    direction: state.direction,
    fontFamily: controls.fontFamily.value,
    fontSize: Number(controls.fontSize.value) || 42,
    lineHeight: Number(controls.lineHeight.value) || 1.25,
    letterSpacing: Number(controls.letterSpacing.value) || 0,
    boxWidth: Number(controls.textBoxWidth.value) || 360,
    color: controls.textColor.value,
    strokeColor: controls.strokeColor.value,
    strokeWidth: Number(controls.strokeWidth.value) || 0,
    bold: state.bold,
    italic: state.italic,
    align: state.align,
  };
}

function addText() {
  if (!state.loaded) {
    toast('請先上傳圖片', 'error');
    return;
  }
  const center = screenToImage(viewport.clientWidth / 2, viewport.clientHeight / 2);
  const obj = {
    id: crypto.randomUUID(),
    x: Math.max(0, Math.min(sourceCanvas.width - 80, center.x - 160)),
    y: Math.max(0, Math.min(sourceCanvas.height - 80, center.y - 40)),
    ...currentTextSettings(),
  };
  state.textObjects.push(obj);
  state.selectedTextId = obj.id;
  syncTextControls(obj);
  render();
  commitHistory();
}

function syncTextControls(obj) {
  if (!obj) return;
  controls.textContent.value = obj.text;
  controls.fontFamily.value = obj.fontFamily;
  controls.fontSize.value = obj.fontSize;
  controls.lineHeight.value = obj.lineHeight;
  controls.letterSpacing.value = obj.letterSpacing;
  controls.textBoxWidth.value = obj.boxWidth;
  controls.textColor.value = obj.color;
  controls.strokeColor.value = obj.strokeColor;
  controls.strokeWidth.value = obj.strokeWidth;
  state.direction = obj.direction;
  state.bold = obj.bold;
  state.italic = obj.italic;
  state.align = obj.align;
  $$('.segmented button').forEach((button) => button.classList.toggle('active', button.dataset.direction === obj.direction));
  $('#boldBtn').classList.toggle('active', obj.bold);
  $('#italicBtn').classList.toggle('active', obj.italic);
  $$('.format-button.align').forEach((button) => button.classList.toggle('active', button.dataset.align === obj.align));
}

function applyControlsToSelected() {
  const obj = selectedText();
  if (!obj) return;
  Object.assign(obj, currentTextSettings());
  render();
  scheduleHistory();
}

function deleteSelectedText() {
  if (!state.selectedTextId) return;
  state.textObjects = state.textObjects.filter((item) => item.id !== state.selectedTextId);
  state.selectedTextId = null;
  render();
  commitHistory();
}

function duplicateSelectedText() {
  const obj = selectedText();
  if (!obj) return;
  const copy = structuredClone(obj);
  copy.id = crypto.randomUUID();
  copy.x += 24;
  copy.y += 24;
  state.textObjects.push(copy);
  state.selectedTextId = copy.id;
  syncTextControls(copy);
  render();
  commitHistory();
}

function maskHasPixels() {
  const data = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 5) return true;
  return false;
}

let cvPromise = null;
function loadOpenCV() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    if (window.cv?.Mat) {
      resolve(window.cv);
      return;
    }
    const existing = document.querySelector('script[data-opencv]');
    if (existing) {
      existing.addEventListener('load', waitForRuntime);
      existing.addEventListener('error', () => reject(new Error('OpenCV 載入失敗')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.x/opencv.js';
    script.async = true;
    script.dataset.opencv = 'true';
    script.onload = waitForRuntime;
    script.onerror = () => reject(new Error('OpenCV 載入失敗，請檢查網絡連線'));
    document.head.appendChild(script);

    async function waitForRuntime() {
      try {
        if (window.cv instanceof Promise) window.cv = await window.cv;
        if (window.cv?.Mat) {
          resolve(window.cv);
        } else if (window.cv) {
          window.cv.onRuntimeInitialized = () => resolve(window.cv);
        } else {
          reject(new Error('OpenCV 初始化失敗'));
        }
      } catch (error) {
        reject(error);
      }
    }
  });
  return cvPromise;
}

async function inpaintMask() {
  if (!state.loaded) return toast('請先上傳圖片', 'error');
  if (!maskHasPixels()) return toast('請先塗抹或框選要去除的原文', 'error');
  setBusy(true, '正在智慧修補原文', '首次使用會載入 OpenCV');
  let srcRGBA; let srcRGB; let maskRGBA; let maskGray; let expanded; let kernel; let dstRGB; let outRGBA;
  try {
    const cv = await loadOpenCV();
    const originalPixels = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
    const alpha = new Uint8ClampedArray(sourceCanvas.width * sourceCanvas.height);
    for (let p = 0; p < alpha.length; p += 1) alpha[p] = originalPixels[p * 4 + 3];
    srcRGBA = cv.imread(sourceCanvas);
    srcRGB = new cv.Mat();
    cv.cvtColor(srcRGBA, srcRGB, cv.COLOR_RGBA2RGB);
    maskRGBA = cv.imread(maskCanvas);
    maskGray = new cv.Mat();
    cv.cvtColor(maskRGBA, maskGray, cv.COLOR_RGBA2GRAY);
    cv.threshold(maskGray, maskGray, 5, 255, cv.THRESH_BINARY);
    expanded = new cv.Mat();
    const expand = Number(controls.expandMask.value);
    if (expand > 0) {
      const k = expand * 2 + 1;
      kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
      cv.dilate(maskGray, expanded, kernel);
    } else {
      maskGray.copyTo(expanded);
    }
    dstRGB = new cv.Mat();
    cv.inpaint(srcRGB, expanded, dstRGB, Number(controls.inpaintRadius.value), cv.INPAINT_TELEA);
    outRGBA = new cv.Mat();
    cv.cvtColor(dstRGB, outRGBA, cv.COLOR_RGB2RGBA);
    cv.imshow(sourceCanvas, outRGBA);
    const restored = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    for (let p = 0; p < alpha.length; p += 1) restored.data[p * 4 + 3] = alpha[p];
    sourceCtx.putImageData(restored, 0, 0);
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    render();
    commitHistory();
    toast('原文區域已修補', 'success');
  } catch (error) {
    console.error(error);
    toast(`修補失敗：${error.message || error}`, 'error');
  } finally {
    [srcRGBA, srcRGB, maskRGBA, maskGray, expanded, kernel, dstRGB, outRGBA].forEach((mat) => mat?.delete?.());
    setBusy(false);
  }
}

function fillMaskedArea(color) {
  if (!state.loaded) return toast('請先上傳圖片', 'error');
  if (!maskHasPixels()) return toast('請先選取要填滿的範圍', 'error');
  const temp = document.createElement('canvas');
  temp.width = sourceCanvas.width;
  temp.height = sourceCanvas.height;
  const ctx = temp.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0);
  sourceCtx.drawImage(temp, 0, 0);
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  render();
  commitHistory();
  toast('所選範圍已填滿', 'success');
}

async function removeBackground() {
  if (!state.loaded) return toast('請先上傳圖片', 'error');
  controls.bgProgressWrap.classList.remove('hidden');
  controls.bgProgressBar.style.width = '3%';
  controls.bgProgressText.textContent = '載入背景消除模組…';
  setBusy(true, '正在移除背景', '首次使用需要下載模型');
  try {
    const [{ default: imglyRemoveBackground }, blob] = await Promise.all([
      import('@imgly/background-removal'),
      canvasToBlob(sourceCanvas),
    ]);
    const result = await imglyRemoveBackground(blob, {
      model: 'isnet_quint8',
      device: 'cpu',
      output: { format: 'image/png', quality: 1, type: 'foreground' },
      progress: (key, current, total) => {
        const percent = total > 0 ? Math.max(3, Math.min(98, Math.round(current / total * 100))) : 12;
        controls.bgProgressBar.style.width = `${percent}%`;
        controls.bgProgressText.textContent = `${key.split('/').pop() || '模型'}：${percent}%`;
        controls.busyDetail.textContent = `下載／處理進度 ${percent}%`;
      },
    });
    const image = await blobToImage(result);
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    sourceCtx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    controls.bgProgressBar.style.width = '100%';
    controls.bgProgressText.textContent = '背景消除完成';
    render();
    commitHistory();
    toast('圖片背景已移除', 'success');
  } catch (error) {
    console.error(error);
    controls.bgProgressText.textContent = '處理失敗';
    toast(`背景消除失敗：${error.message || error}`, 'error');
  } finally {
    setBusy(false);
  }
}

function drawFinalCanvas(format) {
  const output = document.createElement('canvas');
  output.width = sourceCanvas.width;
  output.height = sourceCanvas.height;
  const ctx = output.getContext('2d');
  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, output.width, output.height);
  }
  ctx.drawImage(sourceCanvas, 0, 0);
  state.textObjects.forEach((obj) => drawTextObject(ctx, obj, false));
  return output;
}

async function downloadResult() {
  if (!state.loaded) return toast('請先上傳圖片', 'error');
  try {
    const format = controls.exportFormat.value;
    const quality = Number(controls.exportQuality.value) / 100;
    const output = drawFinalCanvas(format);
    const blob = await canvasToBlob(output, format, quality);
    const ext = format === 'image/jpeg' ? 'jpg' : format.split('/')[1];
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.fileName}_translated.${ext}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('成品已下載', 'success');
  } catch (error) {
    toast(error.message || '下載失敗', 'error');
  }
}

$$('.tool').forEach((button) => button.addEventListener('click', () => {
  state.tool = button.dataset.tool;
  $$('.tool').forEach((item) => item.classList.toggle('active', item === button));
  updateCursor();
}));

controls.fileInput.addEventListener('change', () => loadFile(controls.fileInput.files[0]));
$('#emptyUploadBtn').addEventListener('click', () => controls.fileInput.click());
$('#dropZone').addEventListener('dragover', (event) => { event.preventDefault(); $('#dropZone').classList.add('dragover'); });
$('#dropZone').addEventListener('dragleave', () => $('#dropZone').classList.remove('dragover'));
$('#dropZone').addEventListener('drop', (event) => {
  event.preventDefault();
  $('#dropZone').classList.remove('dragover');
  loadFile(event.dataTransfer.files[0]);
});
viewport.addEventListener('dragover', (event) => event.preventDefault());
viewport.addEventListener('drop', (event) => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); });
window.addEventListener('paste', (event) => {
  const file = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'))?.getAsFile();
  if (file) loadFile(file);
});

controls.brushSize.addEventListener('input', () => controls.brushSizeValue.textContent = `${controls.brushSize.value} px`);
controls.expandMask.addEventListener('input', () => controls.expandValue.textContent = `${controls.expandMask.value} px`);
controls.inpaintRadius.addEventListener('input', () => controls.radiusValue.textContent = `${controls.inpaintRadius.value} px`);
controls.exportQuality.addEventListener('input', () => controls.qualityValue.textContent = `${controls.exportQuality.value}%`);

$('#inpaintBtn').addEventListener('click', inpaintMask);
$('#fillWhiteBtn').addEventListener('click', () => fillMaskedArea('#ffffff'));
$('#fillColorBtn').addEventListener('click', () => fillMaskedArea(controls.fillColor.value));
$('#clearMaskBtn').addEventListener('click', () => {
  if (!state.loaded) return;
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  render();
  commitHistory();
});
$('#removeBgBtn').addEventListener('click', removeBackground);
$('#fitBtn').addEventListener('click', fitImage);
$('#resetBtn').addEventListener('click', () => state.originalBlob && loadFile(state.originalBlob, true));
$('#zoomInBtn').addEventListener('click', () => setZoom(state.zoom * 1.2));
$('#zoomOutBtn').addEventListener('click', () => setZoom(state.zoom / 1.2));
controls.zoomLabel.addEventListener('click', fitImage);
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
$('#downloadBtn').addEventListener('click', downloadResult);

$('#addTextBtn').addEventListener('click', addText);
$('#duplicateTextBtn').addEventListener('click', duplicateSelectedText);
$('#deleteTextBtn').addEventListener('click', deleteSelectedText);
$$('.segmented button').forEach((button) => button.addEventListener('click', () => {
  state.direction = button.dataset.direction;
  $$('.segmented button').forEach((item) => item.classList.toggle('active', item === button));
  applyControlsToSelected();
}));
$('#boldBtn').addEventListener('click', () => {
  state.bold = !state.bold;
  $('#boldBtn').classList.toggle('active', state.bold);
  applyControlsToSelected();
});
$('#italicBtn').addEventListener('click', () => {
  state.italic = !state.italic;
  $('#italicBtn').classList.toggle('active', state.italic);
  applyControlsToSelected();
});
$$('.format-button.align').forEach((button) => button.addEventListener('click', () => {
  state.align = button.dataset.align;
  $$('.format-button.align').forEach((item) => item.classList.toggle('active', item === button));
  applyControlsToSelected();
}));
[
  controls.textContent, controls.fontFamily, controls.fontSize, controls.lineHeight,
  controls.letterSpacing, controls.textBoxWidth, controls.textColor,
  controls.strokeColor, controls.strokeWidth,
].forEach((control) => control.addEventListener('input', applyControlsToSelected));

$('#fullscreenBtn').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await $('.editor-shell').requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    toast('瀏覽器不允許全螢幕', 'error');
  }
});
document.addEventListener('fullscreenchange', () => setTimeout(resizeEditorCanvas, 80));

window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.code === 'Space' && !typing) {
    event.preventDefault();
    state.spacePressed = true;
    updateCursor();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault(); redo();
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && state.selectedTextId) {
    event.preventDefault(); deleteSelectedText();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); downloadResult();
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    state.spacePressed = false;
    updateCursor();
  }
});
window.addEventListener('blur', () => {
  state.spacePressed = false;
  updateCursor();
});

new ResizeObserver(resizeEditorCanvas).observe(viewport);
window.addEventListener('resize', resizeEditorCanvas);
updateHistoryButtons();
resizeEditorCanvas();
