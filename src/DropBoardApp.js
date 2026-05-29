"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { Cog6ToothIcon, EyeIcon, EyeSlashIcon, FunnelIcon } from "@heroicons/react/24/outline";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { CARD_TONE_CLASSES, SWATCH_TONE_CLASSES } from "./dropboardTailwind";
import { dropboardStyles } from "./dropboardStyles";

const COLORS = ["none", "gold", "orange", "pink", "purple", "blue"];

const DEFAULT_COLUMNS = [
  { id: "col-inbox", title: "Inbox", order: 100 },
  { id: "col-week", title: "This Week", order: 200 },
  { id: "col-progress", title: "In Progress", order: 300 },
  { id: "col-blocked", title: "Blocked", order: 400 },
  { id: "col-done", title: "Done", order: 500 }
];
const DATA_SOURCE_KEY = "dropboard.dataSourcePath";

function uid(prefix = "c") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sortByOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

function todayIso() {
  return new Date().toISOString();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.payload = body;
    throw err;
  }
  return body;
}

function ensureShape(data) {
  const columns = (data?.columns?.length ? data.columns : DEFAULT_COLUMNS)
    .slice()
    .sort(sortByOrder)
    .map((col, i) => ({ ...col, order: (i + 1) * 100 }));
  const cards = Array.isArray(data?.cards)
    ? data.cards.map((card) => ({
        ...card,
        // Backward compatibility: legacy figmaUrl maps to new externalUrl.
        externalUrl: (card.externalUrl ?? card.figmaUrl ?? "").trim()
      }))
    : [];
  return {
    version: 1,
    board: data?.board || { id: "board-main", name: "Dashboard", createdAt: todayIso(), updatedAt: todayIso() },
    columns,
    cards,
    settings: data?.settings || {}
  };
}

function renderMarkdownInline(mdText) {
  const raw = String(mdText || "");
  if (!raw.trim()) return "";
  const html = marked.parse(raw, { breaks: true, gfm: true });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_ATTR: ["href", "title", "target", "rel"]
  });
}

function asSafeExternalUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return "";
}

function compactUrlLabel(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  return value.replace(/^https?:\/\//i, "");
}

function swatchClass(color, activeColor) {
  return [
    color === "none"
      ? "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border px-sm font-button-utility text-button-utility transition-colors duration-150 ease-out"
      : "inline-flex h-[44px] w-[44px] items-center justify-center rounded-full border transition-colors duration-150 ease-out",
    SWATCH_TONE_CLASSES[color] || SWATCH_TONE_CLASSES.none,
    activeColor === color ? "border-primary shadow-[0_0_0_1px_#cc3300]" : ""
  ].filter(Boolean).join(" ");
}

function cardColorClass(color) {
  return CARD_TONE_CLASSES[color] || CARD_TONE_CLASSES.none;
}

export default function DropBoardApp({
  boardId = "work",
  boardMode = "local",
  initialDataSourcePath = "",
  allowDeleteBoard = true,
  persistBoardName,
  requestDeleteBoard,
  onBoardDeleted,
  onBoardRenamed,
  onRequestRefresh
}) {
  const [doc, setDoc] = useState(ensureShape({}));
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("Loading...");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [missingDataSource, setMissingDataSource] = useState(null);
  const [configPath, setConfigPath] = useState("");
  const [pathValidationMsg, setPathValidationMsg] = useState("");
  const [pathValidationKind, setPathValidationKind] = useState("info");
  const [activeColorFilters, setActiveColorFilters] = useState([]);
  const [visibleColumnIds, setVisibleColumnIds] = useState([]);

  const [draftCard, setDraftCard] = useState({
    title: "",
    description: "",
    externalUrl: "",
    columnId: DEFAULT_COLUMNS[0].id,
    color: "none"
  });

  const [settingsDraft, setSettingsDraft] = useState({
    boardName: "Dashboard",
    dataSourcePath: "",
    columns: DEFAULT_COLUMNS.map((c) => ({ ...c }))
  });

  function getStoredDataSourcePath() {
    try {
      return localStorage.getItem(`${DATA_SOURCE_KEY}.${boardId}`) || initialDataSourcePath || "";
    } catch {
      return initialDataSourcePath || "";
    }
  }

  function setStoredDataSourcePath(path) {
    try {
      localStorage.setItem(`${DATA_SOURCE_KEY}.${boardId}`, path || "");
    } catch {
      // Ignore localStorage failures; app still works with in-memory state.
    }
  }

  function withDataSourceHeader(path) {
    const clean = (path ?? configPath ?? "").trim();
    return clean ? { "X-DropBoard-Data-Source": clean } : {};
  }

  function boardApi(path) {
    const query = new URLSearchParams({ boardId });
    return `${path}?${query.toString()}`;
  }

  async function loadBoard() {
    const storedPath = getStoredDataSourcePath();
    setConfigPath(storedPath);
    try {
      const res = await api(boardApi("/api/dropboard/data"), { headers: withDataSourceHeader(storedPath) });
      const shaped = ensureShape(res.data || {});
      setDoc(shaped);
      setSelectedId((prev) => prev && shaped.cards.some((c) => c.id === prev) ? prev : (shaped.cards[0]?.id || null));
      setMissingDataSource(null);
      setStatus("Data loaded.");
    } catch (err) {
      if (err.status === 404) {
        setMissingDataSource({ path: err.payload?.path || storedPath || "(default location)" });
        setStatus("Data source not found.");
      } else {
        setStatus(`Load error: ${err.message}`);
      }
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadBoard();
      } catch (err) {
        setStatus(`Startup error: ${err.message}`);
      }
    })();
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setIsAddOpen(false);
        setIsSettingsOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selected = useMemo(() => doc.cards.find((c) => c.id === selectedId) || null, [doc.cards, selectedId]);
  const [selectedDirty, setSelectedDirty] = useState(false);
  const suppressAutoSaveRef = useRef(false);

  useEffect(() => {
    setVisibleColumnIds(doc.columns.map((c) => c.id));
  }, [doc.columns]);

  const cardsByColumn = useMemo(() => {
    const map = Object.fromEntries(doc.columns.map((col) => [col.id, []]));
    for (const card of doc.cards) {
      if (!map[card.columnId]) map[card.columnId] = [];
      map[card.columnId].push(card);
    }
    for (const key of Object.keys(map)) map[key].sort(sortByOrder);
    return map;
  }, [doc]);

  const shownColumns = useMemo(
    () => doc.columns.filter((c) => visibleColumnIds.includes(c.id)),
    [doc.columns, visibleColumnIds]
  );

  function cardMatchesFilters(card) {
    if (!activeColorFilters.length) return true;
    return activeColorFilters.includes(card.color || "none");
  }

  const filteredCardsByColumn = useMemo(() => {
    const out = {};
    for (const col of doc.columns) {
      out[col.id] = (cardsByColumn[col.id] || []).filter(cardMatchesFilters);
    }
    return out;
  }, [doc.columns, cardsByColumn, activeColorFilters]);

  useEffect(() => {
    if (!selected) return;
    const columnVisible = visibleColumnIds.includes(selected.columnId);
    const colorVisible = cardMatchesFilters(selected);
    if (!columnVisible || !colorVisible) {
      setSelectedId(null);
    }
  }, [selected, visibleColumnIds, activeColorFilters]);

  async function persist(nextDoc, okMsg = "Card saved.") {
    const out = { ...nextDoc, board: { ...nextDoc.board, updatedAt: todayIso() } };
    setDoc(out);
    try {
      await api(boardApi("/api/dropboard/data"), { method: "POST", body: { data: out }, headers: withDataSourceHeader() });
      setMissingDataSource(null);
      setStatus(okMsg);
    } catch (err) {
      setStatus(`Save error: ${err.message}`);
    }
  }

  function openAddModal() {
    const first = doc.columns[0]?.id || DEFAULT_COLUMNS[0].id;
    setDraftCard({ title: "", description: "", externalUrl: "", columnId: first, color: "none" });
    setIsAddOpen(true);
  }

  function openSettings() {
    setPathValidationMsg("");
    setPathValidationKind("info");
    setSettingsDraft({
      boardName: doc.board?.name || "Dashboard",
      dataSourcePath: configPath || "",
      columns: doc.columns.map((c) => ({ ...c }))
    });
    setIsSettingsOpen(true);
  }

  async function onAddCard() {
    const first = draftCard.columnId || doc.columns[0]?.id || DEFAULT_COLUMNS[0].id;
    const newCard = {
      id: uid(),
      title: draftCard.title.trim() || "New task",
      description: draftCard.description.trim(),
      externalUrl: draftCard.externalUrl.trim(),
      color: draftCard.color || "none",
      columnId: first,
      order: (cardsByColumn[first]?.length || 0) * 100 + 100,
      createdAt: todayIso(),
      updatedAt: todayIso()
    };
    const next = { ...doc, cards: [...doc.cards, newCard] };
    setSelectedId(newCard.id);
    setIsAddOpen(false);
    await persist(next, "Card saved.");
  }

  function reorder(list, startIndex, endIndex) {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  }

  async function onBoardDragEnd(result) {
    const { source, destination } = result;
    if (!destination) return;

    const sourceId = source.droppableId;
    const destId = destination.droppableId;
    const sourceCards = Array.from(cardsByColumn[sourceId] || []);
    const destCards = sourceId === destId ? sourceCards : Array.from(cardsByColumn[destId] || []);

    if (sourceId === destId) {
      const reordered = reorder(sourceCards, source.index, destination.index).map((card, idx) => ({ ...card, order: (idx + 1) * 100 }));
      const byId = Object.fromEntries(reordered.map((c) => [c.id, c]));
      const cards = doc.cards.map((c) => byId[c.id] || c);
      await persist({ ...doc, cards }, "Card moved.");
      return;
    }

    const [moved] = sourceCards.splice(source.index, 1);
    moved.columnId = destId;
    destCards.splice(destination.index, 0, moved);

    sourceCards.forEach((c, i) => { c.order = (i + 1) * 100; });
    destCards.forEach((c, i) => { c.order = (i + 1) * 100; });

    const touched = [...sourceCards, ...destCards];
    const byId = Object.fromEntries(touched.map((c) => [c.id, c]));
    const cards = doc.cards.map((c) => byId[c.id] ? { ...byId[c.id], updatedAt: todayIso() } : c);
    await persist({ ...doc, cards }, "Card moved.");
  }

  async function onGlobalDragEnd(result) {
    if (result.type === "SETTINGS_COLUMN") {
      onSettingsColumnDragEnd(result);
      return;
    }
    await onBoardDragEnd(result);
  }

  async function commitSelectedIfDirty() {
    if (suppressAutoSaveRef.current) return;
    if (!selected || !selectedDirty) return;
    await persist(doc, "Card saved.");
    setSelectedDirty(false);
  }

  async function handleSelectCard(nextId) {
    if (nextId === selectedId) return;
    await commitSelectedIfDirty();
    setSelectedId(nextId);
  }

  async function handleDeselectCard() {
    if (!selectedId) return;
    await commitSelectedIfDirty();
    setSelectedId(null);
  }

  function toggleColorFilter(color) {
    setActiveColorFilters((prev) => prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]);
  }

  function toggleColumnVisibility(columnId) {
    setVisibleColumnIds((prev) => {
      if (prev.includes(columnId)) {
        if (prev.length <= 1) return prev;
        return prev.filter((id) => id !== columnId);
      }
      return [...prev, columnId];
    });
  }

  async function moveSelectedToColumn(nextColumnId) {
    if (!selected) return;
    if (!nextColumnId || nextColumnId === selected.columnId) return;
    await commitSelectedIfDirty();
    const nextOrder = ((cardsByColumn[nextColumnId]?.length || 0) + 1) * 100;
    const cards = doc.cards.map((c) =>
      c.id === selected.id ? { ...c, columnId: nextColumnId, order: nextOrder, updatedAt: todayIso() } : c
    );
    await persist({ ...doc, cards }, "Card moved.");
  }

  async function deleteSelectedCard() {
    if (!selected) return;
    suppressAutoSaveRef.current = true;
    const ok = window.confirm(`Delete card "${selected.title || "Untitled"}"? This cannot be undone.`);
    if (!ok) {
      suppressAutoSaveRef.current = false;
      return;
    }
    const cards = doc.cards.filter((c) => c.id !== selected.id);
    setSelectedId(null);
    setSelectedDirty(false);
    await persist({ ...doc, cards }, "Card deleted.");
    suppressAutoSaveRef.current = false;
  }

  function onSettingsColumnDragEnd(result) {
    const { source, destination } = result;
    if (!destination) return;
    if (source.index === destination.index) return;
    const cols = settingsDraft.columns.slice();
    const [picked] = cols.splice(source.index, 1);
    cols.splice(destination.index, 0, picked);
    setSettingsDraft((prev) => ({
      ...prev,
      columns: cols.map((c, i) => ({ ...c, order: (i + 1) * 100 }))
    }));
  }

  function addSettingColumn() {
    const cols = settingsDraft.columns.slice();
    cols.push({ id: uid("col"), title: "New Column", order: (cols.length + 1) * 100 });
    setSettingsDraft((prev) => ({ ...prev, columns: cols }));
  }

  function removeSettingColumn(id) {
    if (settingsDraft.columns.length <= 1) return;
    const cols = settingsDraft.columns.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: (i + 1) * 100 }));
    setSettingsDraft((prev) => ({ ...prev, columns: cols }));
  }

  async function saveSettings() {
    const cleanTitle = settingsDraft.boardName.trim() || "Dashboard";
    const cleanPath = settingsDraft.dataSourcePath.trim() || configPath || initialDataSourcePath;
    const pathChanged = cleanPath !== (configPath || "");
    const cleanColumns = settingsDraft.columns
      .map((c, i) => ({ ...c, title: (c.title || "Column").trim() || "Column", order: (i + 1) * 100 }));

    try {
        const validation = await api(boardApi("/api/dropboard/validate-data-source"), { method: "POST", body: { dataSourcePath: cleanPath }, headers: withDataSourceHeader(cleanPath) });
      setPathValidationMsg(`Path valid: ${validation.path}`);
      setPathValidationKind("ok");
    } catch (err) {
      const detail = err.payload?.error || err.message;
      const path = err.payload?.path || cleanPath || "(default local path)";
      setPathValidationMsg(`Path check failed for ${path}: ${detail}`);
      setPathValidationKind("error");
      return;
    }

    await api(boardApi("/api/dropboard/config"), { method: "POST", body: { dataSourcePath: cleanPath } });
    setStoredDataSourcePath(cleanPath);
    setConfigPath(cleanPath);

    // When datasource path changes, reload from the linked file immediately.
    // This avoids persisting stale in-memory state over the newly linked data.
    if (pathChanged) {
      await loadBoard();
      setStatus("Data source updated.");
      setIsSettingsOpen(false);
      return;
    }

    const allowed = new Set(cleanColumns.map((c) => c.id));
    const fallbackId = cleanColumns[0].id;
    const rehomedCards = doc.cards.map((card) => ({
      ...card,
      columnId: allowed.has(card.columnId) ? card.columnId : fallbackId,
      updatedAt: todayIso()
    }));

    const nextDoc = {
      ...doc,
      board: { ...doc.board, name: cleanTitle, updatedAt: todayIso() },
      columns: cleanColumns,
      cards: rehomedCards
    };

    if (persistBoardName) {
      await persistBoardName(cleanTitle);
    }
    onBoardRenamed?.(cleanTitle);

    await persist(nextDoc, "Settings saved.");
    onRequestRefresh?.();
    setIsSettingsOpen(false);
  }

  async function testDataSourcePath() {
    const cleanPath = settingsDraft.dataSourcePath.trim() || configPath || initialDataSourcePath;
    try {
      const validation = await api(boardApi("/api/dropboard/validate-data-source"), {
        method: "POST",
        body: { dataSourcePath: cleanPath },
        headers: withDataSourceHeader(cleanPath)
      });
      setPathValidationMsg(`Path valid: ${validation.path}`);
      setPathValidationKind("ok");
    } catch (err) {
      const detail = err.payload?.error || err.message;
      const path = err.payload?.path || cleanPath || "(default local path)";
      setPathValidationMsg(`Path check failed for ${path}: ${detail}`);
      setPathValidationKind("error");
    }
  }

  async function useDefaultDataSource() {
    setStoredDataSourcePath("");
    setConfigPath("");
    if (isSettingsOpen) {
      setSettingsDraft((prev) => ({ ...prev, dataSourcePath: "" }));
    }
    await loadBoard();
  }

  async function deleteBoard() {
    const first = window.confirm(
      boardMode === "linked"
        ? "Delete this board from Ade's World Builder? The external JSON file will stay intact."
        : "Delete this board? The board will be removed from Ade's World Builder."
    );
    if (!first) return;
    const second = window.confirm("Final warning: this removes the board entry. This cannot be undone.");
    if (!second) return;
    try {
      if (!requestDeleteBoard) {
        setStatus("Delete error: board delete is not configured in this host.");
        return;
      }
      const result = await requestDeleteBoard();
      setIsSettingsOpen(false);
      onBoardDeleted?.({
        deletedBoardId: boardId,
        nextBoardId: result?.nextBoardId || null,
        remainingBoards: result?.remainingBoards || []
      });
    } catch (error) {
      setStatus(`Delete error: ${error.message}`);
    }
  }

  return (
    <div className="min-h-screen bg-canvas px-lg py-lg pb-xl text-body text-ink md:px-xl">
      <style jsx global>{dropboardStyles}</style>
      <DragDropContext onDragEnd={onGlobalDragEnd}>
      <div className="mb-md grid gap-md border-b border-hairline pb-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <h1 className="max-w-[13ch] font-display-lg text-display-lg leading-[1.05] tracking-[-0.02em] text-ink">
          {doc.board?.name || "Dashboard"}
        </h1>
        <div className="flex flex-wrap items-center gap-xs md:justify-end">
          <div className="pr-xxs font-caption text-caption text-ink-muted-48">{status}</div>
          <button
            className="inline-flex min-h-[44px] w-[44px] items-center justify-center rounded-sm border border-hairline bg-canvas-parchment text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            onClick={() => setShowFilters((v) => !v)}
            title="Filters"
            aria-label="Filters"
          >
            <FunnelIcon className="size-4" />
          </button>
          <button
            className="inline-flex min-h-[44px] w-[44px] items-center justify-center rounded-sm border border-hairline bg-canvas-parchment text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            onClick={openSettings}
            title="Settings"
            aria-label="Settings"
          >
            <Cog6ToothIcon className="size-4" />
          </button>
        </div>
      </div>

      {showFilters && (
        <section className="mb-sm grid gap-md rounded-sm border border-hairline bg-canvas-parchment p-md md:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-xs font-caption text-caption text-ink-muted-80">Filter by color</div>
            <div className="flex flex-wrap gap-xs">
              {COLORS.map((color) => (
                <button
                  key={`filter-${color}`}
                  className={swatchClass(color, activeColorFilters.includes(color) ? color : null)}
                  onClick={() => toggleColorFilter(color)}
                >
                  {color === "none" ? "None" : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-xs font-caption text-caption text-ink-muted-80">Show columns</div>
            <div className="flex flex-wrap gap-xs">
              {doc.columns.map((col) => (
                <button
                  key={`col-toggle-${col.id}`}
                  className={[
                    "inline-flex min-h-[44px] items-center gap-xs rounded-sm border px-md font-nav-link text-nav-link uppercase transition-colors duration-150 ease-out hover:border-primary focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
                    visibleColumnIds.includes(col.id)
                      ? "border-hairline bg-canvas text-ink"
                      : "border-hairline bg-canvas-parchment text-ink-muted-48"
                  ].join(" ")}
                  onClick={() => toggleColumnVisibility(col.id)}
                >
                  {visibleColumnIds.includes(col.id) ? <EyeIcon className="size-3 shrink-0" /> : <EyeSlashIcon className="size-3 shrink-0" />}
                  {col.title}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {missingDataSource && (
        <div className="mb-sm rounded-sm border border-primary bg-canvas-parchment p-md">
          <div className="mb-xs font-display-md text-display-md text-ink">Data source not found.</div>
          <div className="mb-xxs text-body text-ink">Current path: <code>{missingDataSource.path}</code></div>
          <div className="text-body text-ink">Open Settings and fix the data source path, or reset to default to use `dropboard.default.json` in this folder.</div>
          <div className="mt-sm flex flex-wrap gap-xs">
            <button className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-primary bg-primary px-md font-button-utility text-button-utility text-on-primary transition-colors duration-150 ease-out hover:border-primary-focus hover:bg-primary-focus focus-visible:border-primary-focus focus-visible:bg-primary-focus focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={openSettings}>Open Settings</button>
            <button className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-hairline bg-canvas-parchment px-md font-button-utility text-button-utility text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={useDefaultDataSource}>Use Default Path</button>
          </div>
        </div>
      )}

      {isAddOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(29,29,31,0.18)] p-md" onClick={() => setIsAddOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-[980px] overflow-auto rounded-sm border border-hairline bg-canvas p-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-sm flex items-start justify-between gap-sm">
              <h3 className="font-display-md text-display-md text-ink">Add Card</h3>
              <button className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-hairline bg-canvas-parchment px-md font-button-utility text-button-utility text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={() => setIsAddOpen(false)}>Cancel</button>
            </div>
            <input className="mb-sm min-h-[44px] w-full rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" placeholder="Task title" value={draftCard.title} onChange={(e) => setDraftCard((prev) => ({ ...prev, title: e.target.value }))} />
            <textarea className="mb-sm min-h-[144px] w-full rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" placeholder="What needs to happen?" value={draftCard.description} onChange={(e) => setDraftCard((prev) => ({ ...prev, description: e.target.value }))} />
            <input className="mb-sm min-h-[44px] w-full rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" placeholder="Optional external link (https://...)" value={draftCard.externalUrl} onChange={(e) => setDraftCard((prev) => ({ ...prev, externalUrl: e.target.value }))} />
            <select className="mb-sm min-h-[44px] w-full appearance-none rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" value={draftCard.columnId} onChange={(e) => setDraftCard((prev) => ({ ...prev, columnId: e.target.value }))}>
              {doc.columns.map((col) => <option key={col.id} value={col.id}>{col.title}</option>)}
            </select>
            <div className="mb-xs font-caption text-caption text-ink-muted-80">Color</div>
            <div className="mb-md flex flex-wrap gap-xs">
              {COLORS.map((color) => (
                <button
                  key={color}
                  className={swatchClass(color, draftCard.color)}
                  onClick={() => setDraftCard((prev) => ({ ...prev, color }))}
                >
                  {color === "none" ? "None" : ""}
                </button>
              ))}
            </div>
            <button className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-primary bg-primary px-md font-button-utility text-button-utility text-on-primary transition-colors duration-150 ease-out hover:border-primary-focus hover:bg-primary-focus focus-visible:border-primary-focus focus-visible:bg-primary-focus focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={onAddCard}>Save</button>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(29,29,31,0.18)] p-md" onClick={() => setIsSettingsOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-[1020px] overflow-auto rounded-sm border border-hairline bg-canvas p-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-sm flex items-start justify-between gap-sm">
              <h3 className="font-display-md text-display-md text-ink">Settings</h3>
              <button className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-hairline bg-canvas-parchment px-md font-button-utility text-button-utility text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={() => setIsSettingsOpen(false)}>Close</button>
            </div>

            <div className="mb-xs font-caption text-caption text-ink-muted-80">Dashboard title</div>
            <input
              className="mb-sm min-h-[44px] w-full rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
              value={settingsDraft.boardName}
              onChange={(e) => setSettingsDraft((prev) => ({ ...prev, boardName: e.target.value }))}
            />

            <div className="mb-xs font-caption text-caption text-ink-muted-80">Data source path</div>
            <input
              className="mb-sm min-h-[44px] w-full rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
              value={settingsDraft.dataSourcePath}
              onChange={(e) => setSettingsDraft((prev) => ({ ...prev, dataSourcePath: e.target.value }))}
            />
            <div className="text-caption text-ink-muted-48">Blank means default local file in app folder. Use absolute path for shared iCloud/OneDrive JSON.</div>
            <div className="mb-xs mt-xs">
              <button className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-hairline bg-canvas-parchment px-md font-button-utility text-button-utility text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={testDataSourcePath}>Test Path</button>
            </div>
            {pathValidationMsg && <div className={`text-caption ${pathValidationKind === "ok" || pathValidationKind === "error" ? "text-primary" : "text-ink-muted-48"}`}>{pathValidationMsg}</div>}

            <div className="mt-sm">
              <div className="mb-xs font-caption text-caption text-ink-muted-80">Columns</div>
            </div>

            <Droppable droppableId="settings-columns-droppable" type="SETTINGS_COLUMN">
              {(provided) => (
                <div className="mt-xs grid gap-xs" ref={provided.innerRef} {...provided.droppableProps}>
                  {settingsDraft.columns.map((col, idx) => (
                    <Draggable key={col.id} draggableId={`settings-${col.id}`} index={idx}>
                      {(dragProvided) => (
                        <div
                          className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-xs rounded-sm border border-hairline bg-canvas-parchment p-[10px]"
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                        >
                          <span
                            className="inline-flex min-h-[44px] w-[44px] select-none items-center justify-center rounded-sm border border-hairline bg-canvas text-ink-muted-48 transition-colors duration-150 ease-out hover:border-primary hover:text-primary"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                          >
                            ⋮⋮
                          </span>
                          <input
                            className="min-h-[44px] min-w-0 rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                            value={col.title}
                            onChange={(e) => setSettingsDraft((prev) => ({
                              ...prev,
                              columns: prev.columns.map((c) => c.id === col.id ? { ...c, title: e.target.value } : c)
                            }))}
                          />
                          <button className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-hairline bg-canvas-parchment px-md font-button-utility text-button-utility text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-45" onClick={() => removeSettingColumn(col.id)} disabled={settingsDraft.columns.length <= 1}>Remove</button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
            <button className="mt-xs inline-flex min-h-[44px] items-center justify-center rounded-sm border border-hairline bg-canvas-parchment px-md font-button-utility text-button-utility text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={addSettingColumn}>+ Add Column</button>

            <div className="mt-sm">
              <button className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-primary bg-primary px-md font-button-utility text-button-utility text-on-primary transition-colors duration-150 ease-out hover:border-primary-focus hover:bg-primary-focus focus-visible:border-primary-focus focus-visible:bg-primary-focus focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={saveSettings}>Save Settings</button>
            </div>
            {allowDeleteBoard ? (
              <div className="mt-sm flex flex-wrap items-start justify-between gap-sm border-t border-divider-soft pt-sm">
                <div className="text-caption text-primary">
                  Danger zone: deleting this board removes it from the app{boardMode === "linked" ? " but keeps the linked JSON file." : " and deletes its local board file."}
                </div>
                <button className="inline-flex min-h-[44px] w-fit items-center justify-center self-start rounded-sm border border-primary bg-canvas px-md font-button-utility text-button-utility text-primary transition-colors duration-150 ease-out hover:bg-[rgba(204,51,0,0.06)] focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={deleteBoard}>Delete Board</button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="overflow-x-auto pt-xxs pb-sm" onClick={handleDeselectCard}>
        <div className="grid min-w-full w-max max-h-[72vh] grid-flow-col auto-cols-[290px] content-start gap-sm xl:auto-cols-[240px]">
          {shownColumns.map((col) => {
            const cards = filteredCardsByColumn[col.id] || [];
            return (
              <Droppable droppableId={col.id} key={col.id} type="CARD">
                {(provided) => (
                  <section className="flex min-h-[560px] min-w-[290px] max-w-full flex-col rounded-sm border border-hairline bg-canvas-parchment p-md xl:min-h-[420px] xl:min-w-[240px]" ref={provided.innerRef} {...provided.droppableProps}>
                    <div className="mb-sm flex items-baseline justify-between gap-sm font-caption text-caption text-ink-muted-80">
                      <span>{col.title}</span>
                      <span>{cards.length}</span>
                    </div>
                    {col.id === shownColumns[0]?.id && (
                      <button className="mb-sm inline-flex min-h-[44px] w-fit items-center justify-center self-start rounded-sm border border-primary bg-primary px-md font-button-utility text-button-utility text-on-primary transition-colors duration-150 ease-out hover:border-primary-focus hover:bg-primary-focus focus-visible:border-primary-focus focus-visible:bg-primary-focus focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onClick={(e) => { e.stopPropagation(); openAddModal(); }}>
                        + Add card
                      </button>
                    )}
                    <div className="min-h-[180px] min-w-0 max-h-[52vh] overflow-y-auto">
                      {cards.map((card, index) => (
                        <Draggable draggableId={card.id} index={index} key={card.id}>
                          {(dragProvided) => (
                            <article
                              className={[
                                "mb-sm w-full min-w-0 max-w-full max-h-[260px] cursor-pointer overflow-auto rounded-sm border p-sm shadow-[0_0_0_rgba(0,0,0,0)] transition-shadow duration-150 ease-out hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]",
                                cardColorClass(card.color),
                                selectedId === card.id ? "shadow-[0_6px_20px_rgba(0,0,0,0.10)]" : ""
                              ].join(" ")}
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              onClick={async (e) => { e.stopPropagation(); await handleSelectCard(card.id); }}
                            >
                              <h3 className="mb-xs font-tagline text-tagline text-ink">{card.title || "Untitled"}</h3>
                              <div
                                className="dropboard-markdown min-w-0 text-body text-ink"
                                dangerouslySetInnerHTML={{ __html: renderMarkdownInline(card.description || "") }}
                              />
                              {asSafeExternalUrl(card.externalUrl) && (
                                <a
                                  className="mt-sm block max-w-full truncate font-caption-strong text-caption text-primary"
                                  href={asSafeExternalUrl(card.externalUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={card.externalUrl}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {compactUrlLabel(card.externalUrl)}
                                </a>
                              )}
                            </article>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </section>
                )}
              </Droppable>
            );
          })}
        </div>
      </div>

      {selected && (
        <section className="mt-sm grid gap-sm rounded-sm border border-hairline bg-canvas-parchment p-md" onClick={(e) => e.stopPropagation()}>
          <h2 className="mb-xxs font-display-md text-display-md text-ink">Card Details</h2>
          <input
            className="min-h-[44px] w-full rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            placeholder="Task title"
            value={selected.title || ""}
            onChange={(e) => selected && setDoc((prev) => {
              setSelectedDirty(true);
              return { ...prev, cards: prev.cards.map((c) => c.id === selected.id ? { ...c, title: e.target.value, updatedAt: todayIso() } : c) };
            })}
            onBlur={commitSelectedIfDirty}
          />
          <textarea
            className="min-h-[144px] w-full rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            placeholder="What needs to happen?"
            value={selected.description || ""}
            onChange={(e) => selected && setDoc((prev) => {
              setSelectedDirty(true);
              return { ...prev, cards: prev.cards.map((c) => c.id === selected.id ? { ...c, description: e.target.value, updatedAt: todayIso() } : c) };
            })}
            onBlur={commitSelectedIfDirty}
          />
          <input
            className="min-h-[44px] w-full rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            placeholder="Optional external link (https://...)"
            value={selected.externalUrl || ""}
            onChange={(e) => selected && setDoc((prev) => {
              setSelectedDirty(true);
              return { ...prev, cards: prev.cards.map((c) => c.id === selected.id ? { ...c, externalUrl: e.target.value, updatedAt: todayIso() } : c) };
            })}
            onBlur={commitSelectedIfDirty}
          />
          <select
            className="min-h-[44px] w-full appearance-none rounded-sm border border-hairline bg-canvas px-md py-xs text-body text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            value={selected.columnId || ""}
            onChange={(e) => moveSelectedToColumn(e.target.value)}
          >
            {doc.columns.map((col) => (
              <option key={col.id} value={col.id}>{col.title}</option>
            ))}
          </select>

          <div className="mb-xs font-caption text-caption text-ink-muted-80">Color</div>
          <div className="flex flex-wrap gap-xs">
            {COLORS.map((color) => (
              <button
                key={color}
                className={swatchClass(color, selected?.color)}
                onClick={() => {
                  if (!selected) return;
                  setSelectedDirty(true);
                  setDoc((prev) => ({ ...prev, cards: prev.cards.map((c) => c.id === selected.id ? { ...c, color, updatedAt: todayIso() } : c) }));
                }}
              >
                {color === "none" ? "None" : ""}
              </button>
            ))}
          </div>
          <button className="inline-flex min-h-[44px] w-fit items-center justify-center self-start rounded-sm border border-primary bg-canvas px-md font-button-utility text-button-utility text-primary transition-colors duration-150 ease-out hover:bg-[rgba(204,51,0,0.06)] focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" onMouseDown={(e) => e.preventDefault()} onClick={deleteSelectedCard}>
            Delete card
          </button>
        </section>
      )}
      </DragDropContext>
    </div>
  );
}
