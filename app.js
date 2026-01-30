const validViews = ["intro", "about", "sky", "index"];

const viewSections = new Map(
  validViews.map((viewId) => [viewId, document.getElementById(viewId)])
);
const navButtons = document.querySelectorAll("[data-view]");
const aboutButton = document.querySelector("[data-action='about']");
const aboutCloseButton = document.querySelector("[data-action='about-close']");
const siteLogo = document.querySelector(".site-logo");
const viewToggleButtons = document.querySelectorAll(".view-toggle [data-view]");
const viewToggle = document.querySelector(".toggle-switch");
const skySvg = document.querySelector(".sky-draw");
const selectionOverlay = document.querySelector(".selection-overlay");
const selectionInputs = document.querySelectorAll(".selection-input");
const selectionSubmit = document.querySelector(".selection-submit");
const indexGallery = document.querySelector(".index-gallery");
const instructionText = document.querySelector(".instruction-text");
const body = document.body;
const TRANSITION_MS = 320;
let currentView = "sky";
let transitionTimeoutId;
let lastNonAboutView = "intro";
let aboutOpen = false;
const MIN_POINT_DISTANCE = 3;
let isDrawing = false;
let activePointerId = null;
let currentPolyline = null;
let currentStrokePoints = [];
const strokes = [];
let isDraggingAnchor = false;
let activeAnchor = null;
let activeStroke = null;
const SIMPLIFY_EPSILON = 2.5;
let maskPathEl = null;
let maskRectEl = null;
let overlayRectEl = null;
let hasDrawnStroke = false;
let lastSelectionPathData = "";
let lastSelectionPoints = [];
let skyImagePromise = null;
let directoryHandle = null;

// Supabase is now used instead of local server
// Configuration is in supabase-config.js

function setView(viewId, options = {}) {
  if (!validViews.includes(viewId)) {
    console.warn(`Unknown view: ${viewId}`);
    return;
  }

  const { preserveScroll = false, animate = false } = options;
  const previousView = currentView;
  currentView = viewId;
  body.dataset.view = viewId;
  if (viewId !== "sky") {
    updateMaskPath("");
    hideSelectionOverlay();
  } else if (strokes.length === 0) {
    updateMaskPath("");
    hideSelectionOverlay();
  }
  if (viewId !== "about") {
    lastNonAboutView = viewId;
  }

  viewSections.forEach((section, id) => {
    if (!section) return;
    if (id === viewId) {
      section.classList.add("is-active");
      section.classList.remove("is-exiting");
      return;
    }

    if (animate && id === previousView) {
      section.classList.add("is-exiting");
      return;
    }

    section.classList.remove("is-active", "is-exiting");
  });

  if (animate && previousView !== viewId) {
    const previousSection = viewSections.get(previousView);
    if (previousSection) {
      if (transitionTimeoutId) {
        window.clearTimeout(transitionTimeoutId);
      }
      transitionTimeoutId = window.setTimeout(() => {
        previousSection.classList.remove("is-active", "is-exiting");
      }, TRANSITION_MS);
    }
  }

  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewId);
  });
  updateToggleState(viewId);

  if (viewId !== "intro" && !preserveScroll) {
    window.scrollTo(0, 0);
  }

  if (viewId === "index") {
    loadIndexGallery();
  }

  body.classList.remove("intro-locked");
  if (!aboutOpen) {
    body.classList.remove("about-ready");
  }
  body.classList.add("is-scrolled");
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.closest(".toggle-switch")) return;
    const viewId = button.dataset.view;
    if (viewId) setView(viewId);
  });
});

function setToggleEnabled(isEnabled) {
  viewToggleButtons.forEach((button) => {
    button.disabled = !isEnabled;
  });
}

function updateToggleState(activeView) {
  if (!viewToggle) return;
  const effectiveView =
    activeView === "sky" || activeView === "index"
      ? activeView
      : lastNonAboutView;
  viewToggle.classList.toggle("is-index", effectiveView === "index");
  viewToggle.classList.toggle("is-sky", effectiveView === "sky");
}

if (viewToggle) {
  viewToggle.addEventListener("click", () => {
    const anyEnabled = Array.from(viewToggleButtons).some(
      (button) => !button.disabled
    );
    if (!anyEnabled) return;

    const targetView = viewToggle.classList.contains("is-index")
      ? "sky"
      : "index";
    setView(targetView, { animate: true });
  });
}

if (aboutButton) {
  aboutButton.addEventListener("click", () => {
    aboutOpen = !aboutOpen;
    body.classList.toggle("about-ready", aboutOpen);
  });
}

if (aboutCloseButton) {
  aboutCloseButton.addEventListener("click", () => {
    aboutOpen = false;
    body.classList.remove("about-ready");
  });
}

function updateLogoBottom() {
  if (!siteLogo) return;
  const logoRect = siteLogo.getBoundingClientRect();
  body.style.setProperty("--logo-bottom", `${logoRect.bottom}px`);
}

function setSkyViewBox() {
  if (!skySvg) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  skySvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (maskRectEl) {
    maskRectEl.setAttribute("width", `${width}`);
    maskRectEl.setAttribute("height", `${height}`);
  }
  if (overlayRectEl) {
    overlayRectEl.setAttribute("width", `${width}`);
    overlayRectEl.setAttribute("height", `${height}`);
  }
}

function getSkyPoint(event) {
  const rect = skySvg.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function updatePolylinePoints(polyline, points) {
  const pointsString = points.map((point) => `${point.x},${point.y}`).join(" ");
  polyline.setAttribute("points", pointsString);
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = start.x + clamped * dx;
  const projY = start.y + clamped * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function simplifyRdp(points, epsilon) {
  if (points.length <= 2) return points.slice();
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = pointToSegmentDistance(points[i], points[0], points.at(-1));
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }
  if (maxDistance > epsilon) {
    const left = simplifyRdp(points.slice(0, index + 1), epsilon);
    const right = simplifyRdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points.at(-1)];
}

function buildPathData(points) {
  if (!points.length) return "";
  if (points.length < 3) {
    const [first, ...rest] = points;
    return (
      `M ${first.x} ${first.y} ` +
      rest.map((p) => `L ${p.x} ${p.y}`).join(" ")
    );
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function buildClosedPathData(points) {
  if (points.length < 2) return buildPathData(points);
  if (points.length < 3) {
    const [first, second] = points;
    return `M ${first.x} ${first.y} L ${second.x} ${second.y} Z`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const p0 = points[(i - 1 + count) % count];
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    const p3 = points[(i + 2) % count];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return `${d} Z`;
}

function renderAnchors(points, strokeIndex) {
  const fragment = document.createDocumentFragment();
  points.forEach((point, idx) => {
    const anchor = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );
    const size = 6;
    anchor.setAttribute("x", point.x - size / 2);
    anchor.setAttribute("y", point.y - size / 2);
    anchor.setAttribute("width", size);
    anchor.setAttribute("height", size);
    anchor.setAttribute("class", "anchor-point");
    anchor.dataset.strokeIndex = `${strokeIndex}`;
    anchor.dataset.pointIndex = `${idx}`;
    fragment.appendChild(anchor);
  });
  return fragment;
}

function refreshAnchors(stroke) {
  if (!stroke.anchorsGroup) return;
  while (stroke.anchorsGroup.firstChild) {
    stroke.anchorsGroup.removeChild(stroke.anchorsGroup.firstChild);
  }
  stroke.anchorsGroup.appendChild(
    renderAnchors(stroke.points, stroke.index)
  );
}

function ensureSkyMask() {
  if (!skySvg || overlayRectEl) return;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const mask = document.createElementNS("http://www.w3.org/2000/svg", "mask");
  mask.setAttribute("id", "sky-mask");

  const maskRect = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect"
  );
  maskRect.setAttribute("x", "0");
  maskRect.setAttribute("y", "0");
  maskRect.setAttribute("fill", "white");

  const maskPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  maskPath.setAttribute("fill", "black");

  mask.appendChild(maskRect);
  mask.appendChild(maskPath);
  defs.appendChild(mask);
  skySvg.appendChild(defs);

  const overlayRect = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect"
  );
  overlayRect.setAttribute("x", "0");
  overlayRect.setAttribute("y", "0");
  overlayRect.setAttribute("fill", "rgba(0, 0, 0, 0.25)");
  overlayRect.setAttribute("mask", "url(#sky-mask)");
  overlayRect.setAttribute("pointer-events", "none");
  overlayRect.style.display = "none";
  skySvg.appendChild(overlayRect);

  maskPathEl = maskPath;
  maskRectEl = maskRect;
  overlayRectEl = overlayRect;
  setSkyViewBox();
}

function updateMaskPath(pathData) {
  if (!maskPathEl || !overlayRectEl) return;
  if (!pathData) {
    overlayRectEl.style.display = "none";
    maskPathEl.setAttribute("d", "");
    return;
  }
  overlayRectEl.style.display = "block";
  maskPathEl.setAttribute("d", pathData);
}

function loadSkyImage() {
  if (skyImagePromise) return skyImagePromise;
  skyImagePromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "assets/sky.png";
  });
  return skyImagePromise;
}

function buildSelectionSvg(pathData) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <path d="${pathData}" fill="none" stroke="#00b7ff" stroke-width="1.5" />
</svg>`;
}

async function uploadToSupabase(payload, pngBlob) {
  try {
    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `cloud_${timestamp}.png`;

    // Upload PNG to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from(STORAGE_BUCKET)
      .upload(filename, pngBlob, {
        contentType: "image/png",
        cacheControl: "3600",
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return false;
    }

    // Get public URL for the uploaded image
    const { data: urlData } = supabaseClient.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filename);

    const pngUrl = urlData?.publicUrl || "";

    // Insert metadata into selections table
    const { error: insertError } = await supabaseClient.from("selections").insert({
      what: payload.what,
      name: payload.name,
      path_data: payload.pathData,
      points: payload.points,
      png_url: pngUrl,
    });

    if (insertError) {
      console.error("Insert error:", insertError);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Supabase save error:", error);
    return false;
  }
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

function formatDisplayTimestamp(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
}

async function saveSelection() {
  if (!lastSelectionPathData || lastSelectionPoints.length === 0) return false;
  const [whatInput, nameInput] = selectionInputs;
  const payload = {
    timestamp: new Date().toISOString(),
    what: whatInput?.value.trim() ?? "",
    name: nameInput?.value.trim() ?? "",
    pathData: lastSelectionPathData,
    points: lastSelectionPoints,
  };

  const img = await loadSkyImage();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  const path2d = new Path2D(lastSelectionPathData);
  ctx.globalCompositeOperation = "destination-in";
  ctx.fill(path2d);

  const pngBlob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );

  // Try to save to Supabase
  const savedToSupabase = await uploadToSupabase(payload, pngBlob);
  if (savedToSupabase) {
    clearSkyDrawing();
    return true;
  }

  // Fallback: download files locally if Supabase fails
  const timestamp = formatTimestamp(new Date());
  const jsonName = `selection_${timestamp}.json`;
  const pngName = `selection_${timestamp}.png`;
  const svgName = `selection_${timestamp}.svg`;
  const svgString = buildSelectionSvg(lastSelectionPathData);

  const download = (blob, name) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  download(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    jsonName
  );
  download(pngBlob, pngName);
  download(new Blob([svgString], { type: "image/svg+xml" }), svgName);
  clearSkyDrawing();
  return true;
}

function setSelectionOverlayPosition(points) {
  if (!selectionOverlay || !points.length) return;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const gap = 12;

  selectionOverlay.hidden = false;
  selectionOverlay.style.display = "flex";
  if (selectionSubmit) {
    selectionSubmit.hidden = false;
  }
  const overlayWidth = selectionOverlay.offsetWidth;
  const viewportWidth = window.innerWidth;
  const left = Math.max(8, Math.min(minX, viewportWidth - overlayWidth - 8));
  selectionOverlay.style.left = `${left}px`;
  selectionOverlay.style.transform = "none";

  const overlayHeight = selectionOverlay.offsetHeight;
  const viewportHeight = window.innerHeight;
  const belowTop = maxY + gap;
  const aboveTop = minY - gap - overlayHeight;

  if (belowTop + overlayHeight <= viewportHeight) {
    selectionOverlay.style.top = `${belowTop}px`;
  } else {
    selectionOverlay.style.top = `${Math.max(8, aboveTop)}px`;
  }
}

function hideSelectionOverlay() {
  if (!selectionOverlay) return;
  selectionOverlay.hidden = true;
  selectionOverlay.style.display = "none";
  if (selectionSubmit) {
    selectionSubmit.disabled = true;
  }
  lastSelectionPathData = "";
  lastSelectionPoints = [];
  selectionInputs.forEach((input) => {
    input.value = "";
  });
  updateSelectionSubmit();
}

function clearSkyDrawing() {
  strokes.forEach((stroke) => {
    if (stroke.path) stroke.path.remove();
    if (stroke.anchorsGroup) stroke.anchorsGroup.remove();
  });
  strokes.length = 0;
  updateMaskPath("");
  hideSelectionOverlay();
}

function hideInstructionText() {
  if (!instructionText) return;
  instructionText.classList.add("is-hidden");
}

if (skySvg) {
  ensureSkyMask();
  skySvg.addEventListener("pointerdown", (event) => {
    hideInstructionText();
    if (currentView !== "sky") return;
    if (event.target.closest(".anchor-point")) {
      const anchor = event.target.closest(".anchor-point");
      const strokeIndex = Number(anchor.dataset.strokeIndex);
      const pointIndex = Number(anchor.dataset.pointIndex);
      const stroke = strokes[strokeIndex];
      if (!stroke) return;
      isDraggingAnchor = true;
      activeAnchor = { strokeIndex, pointIndex };
      activeStroke = stroke;
      skySvg.setPointerCapture(event.pointerId);
      activePointerId = event.pointerId;
      return;
    }
    event.preventDefault();
    setSkyViewBox();
    skySvg.setPointerCapture(event.pointerId);
    activePointerId = event.pointerId;
    isDrawing = true;
    hasDrawnStroke = false;

    const point = getSkyPoint(event);
    currentStrokePoints = [point];

    const polyline = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline"
    );
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "#00b7ff");
    polyline.setAttribute("stroke-width", "1.5");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    updatePolylinePoints(polyline, currentStrokePoints);
    skySvg.appendChild(polyline);

    currentPolyline = polyline;
  });

  skySvg.addEventListener("pointermove", (event) => {
    if (isDraggingAnchor && event.pointerId === activePointerId) {
      const point = getSkyPoint(event);
      const { pointIndex } = activeAnchor;
      activeStroke.points[pointIndex] = point;
      const pathData = buildClosedPathData(activeStroke.points);
      activeStroke.path.setAttribute("d", pathData);
      updateMaskPath(pathData);
      lastSelectionPathData = pathData;
      lastSelectionPoints = activeStroke.points.map((point) => ({ ...point }));
      refreshAnchors(activeStroke);
      return;
    }
    if (!isDrawing || event.pointerId !== activePointerId) return;
    const point = getSkyPoint(event);
    const lastPoint = currentStrokePoints[currentStrokePoints.length - 1];
    const dx = point.x - lastPoint.x;
    const dy = point.y - lastPoint.y;
    if (Math.hypot(dx, dy) < MIN_POINT_DISTANCE) return;
    if (!hasDrawnStroke) {
      clearSkyDrawing();
      hasDrawnStroke = true;
    }
    currentStrokePoints.push(point);
    updatePolylinePoints(currentPolyline, currentStrokePoints);
  });

  const endStroke = (event) => {
    if (isDraggingAnchor && event.pointerId === activePointerId) {
      isDraggingAnchor = false;
      activeAnchor = null;
      activeStroke = null;
      activePointerId = null;
      skySvg.releasePointerCapture(event.pointerId);
      return;
    }
    if (!isDrawing || event.pointerId !== activePointerId) return;
    isDrawing = false;
    activePointerId = null;
    if (!hasDrawnStroke) {
      if (currentPolyline) {
        currentPolyline.remove();
      }
      currentPolyline = null;
      currentStrokePoints = [];
      clearSkyDrawing();
      skySvg.releasePointerCapture(event.pointerId);
      return;
    }
    if (currentPolyline && currentStrokePoints.length > 1) {
      const simplified = simplifyRdp(currentStrokePoints, SIMPLIFY_EPSILON);
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#00b7ff");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      const pathData = buildClosedPathData(simplified);
      path.setAttribute("d", pathData);
      skySvg.appendChild(path);

      const anchorsGroup = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g"
      );
      const strokeIndex = strokes.length;
      anchorsGroup.appendChild(renderAnchors(simplified, strokeIndex));
      skySvg.appendChild(anchorsGroup);

      strokes.push({
        index: strokeIndex,
        points: simplified,
        path,
        anchorsGroup,
      });

      updateMaskPath(pathData);
      lastSelectionPathData = pathData;
      lastSelectionPoints = simplified.map((point) => ({ ...point }));
      setSelectionOverlayPosition(simplified);
      skySvg.removeChild(currentPolyline);
    } else if (currentPolyline && currentStrokePoints.length === 1) {
      currentPolyline.remove();
      clearSkyDrawing();
    }
    currentPolyline = null;
    currentStrokePoints = [];
    skySvg.releasePointerCapture(event.pointerId);
  };

  skySvg.addEventListener("pointerup", endStroke);
  skySvg.addEventListener("pointercancel", endStroke);

  window.addEventListener("resize", () => {
    if (currentView === "sky") setSkyViewBox();
  updateLogoBottom();
  });
}

document.addEventListener("pointerdown", () => {
  hideInstructionText();
});

function updateSelectionSubmit() {
  if (!selectionSubmit || selectionInputs.length < 2) return;
  const hasValues = Array.from(selectionInputs).every(
    (input) => input.value.trim().length > 0
  );
  selectionSubmit.disabled = !hasValues;
}

async function renderIndexGallery(items) {
  if (!indexGallery) return;
  indexGallery.textContent = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "index-caption";
    empty.textContent = "No selections yet.";
    indexGallery.appendChild(empty);
    return;
  }

  const xlinkNS = "http://www.w3.org/1999/xlink";

  const getPathBBox = (pathData, viewBox) => {
    const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    tempSvg.setAttribute("viewBox", viewBox);
    tempSvg.style.position = "absolute";
    tempSvg.style.width = "0";
    tempSvg.style.height = "0";
    tempSvg.style.visibility = "hidden";
    const tempPath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );
    tempPath.setAttribute("d", pathData);
    tempSvg.appendChild(tempPath);
    document.body.appendChild(tempSvg);
    const bbox = tempPath.getBBox();
    document.body.removeChild(tempSvg);
    return bbox;
  };

  // Items are already sorted by created_at from Supabase query
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "index-card";

    const preview = document.createElement("div");
    preview.className = "index-preview";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("index-svg");
    let rendered = false;

    try {
      // Use pathData from metadata (stored in Supabase)
      const pathData = item.meta?.pathData || "";
      if (!pathData) throw new Error("empty path");

      // Use a reasonable default viewBox based on typical screen size
      const fullWidth = 1920;
      const fullHeight = 1080;
      const sourceViewBox = `0 0 ${fullWidth} ${fullHeight}`;

      const bbox = getPathBBox(pathData, sourceViewBox);
      const padding = 8;
      const paddedBox = {
        x: Math.max(0, bbox.x - padding),
        y: Math.max(0, bbox.y - padding),
        width: Math.min(fullWidth, bbox.width + padding * 2),
        height: Math.min(fullHeight, bbox.height + padding * 2),
      };
      const bboxViewBox = `${paddedBox.x} ${paddedBox.y} ${paddedBox.width} ${paddedBox.height}`;

      svg.setAttribute("viewBox", bboxViewBox);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      const clipPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "clipPath"
      );
      const clipId = `clip-${item.baseName}`;
      clipPath.setAttribute("id", clipId);
      clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");

      const clipShape = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      clipShape.setAttribute("d", pathData);
      clipPath.appendChild(clipShape);
      defs.appendChild(clipPath);
      svg.appendChild(defs);

      const image = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "image"
      );
      image.setAttribute("width", `${fullWidth}`);
      image.setAttribute("height", `${fullHeight}`);
      image.setAttribute("clip-path", `url(#${clipId})`);
      image.setAttribute("href", "assets/sky.png");
      image.setAttributeNS(xlinkNS, "href", "assets/sky.png");
      svg.appendChild(image);

      const outline = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      outline.setAttribute("d", pathData);
      outline.setAttribute("class", "index-outline");
      svg.appendChild(outline);
      rendered = true;
    } catch (error) {
      rendered = false;
    }

    if (!rendered) {
      const fallback = document.createElement("div");
      fallback.className = "index-caption";
      fallback.textContent = "Preview unavailable";
      preview.appendChild(fallback);
    } else {
      preview.appendChild(svg);
    }

    const caption = document.createElement("div");
    caption.className = "index-caption";
    const what = item.meta?.what || "";
    const name = item.meta?.name || "";
    const timestamp = formatDisplayTimestamp(item.meta?.timestamp || "");
    const lines = [
      `${what}${name ? ` — ${name}` : ""}`.trim(),
      timestamp,
    ].filter(Boolean);
    caption.textContent = lines.join("\n");

    card.appendChild(preview);
    card.appendChild(caption);
    indexGallery.appendChild(card);
  }
}

async function loadIndexGallery() {
  if (!indexGallery) return;
  try {
    const { data, error } = await supabaseClient
      .from("selections")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Transform Supabase data to match expected format
    const items = (data || []).map((row) => ({
      baseName: `selection_${row.id}`,
      meta: {
        timestamp: row.created_at,
        what: row.what,
        name: row.name,
        pathData: row.path_data,
        points: row.points,
      },
      png: row.png_url,
      pngUrl: row.png_url,
    }));

    renderIndexGallery(items);
  } catch (error) {
    console.error("Failed to load gallery:", error);
    renderIndexGallery([]);
  }
}

selectionInputs.forEach((input) => {
  input.addEventListener("input", updateSelectionSubmit);
});

if (selectionSubmit) {
  selectionSubmit.addEventListener("click", async () => {
    const saved = await saveSelection();
    if (saved) {
      setView("index", { animate: true });
      await loadIndexGallery();
    }
  });
}

setToggleEnabled(true);
setView("sky");
updateLogoBottom();

window.setView = setView;