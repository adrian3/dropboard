"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { Eye, EyeOff, Funnel, Settings } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
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
    board: data?.board || { id: "board-main", name: "Work Dashboard", createdAt: todayIso(), updatedAt: todayIso() },
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
    boardName: "Work Dashboard",
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
      boardName: doc.board?.name || "Work Dashboard",
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
    const cleanTitle = settingsDraft.boardName.trim() || "Work Dashboard";
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
    <div className="app">
      <style jsx global>{dropboardStyles}</style>
      <DragDropContext onDragEnd={onGlobalDragEnd}>
      <div className="header-row">
        <h1 className="title">{doc.board?.name || "Work Dashboard"}</h1>
        <div className="topbar">
          <div className="note">{status}</div>
          <button className="icon-btn" onClick={() => setShowFilters((v) => !v)} title="Filters" aria-label="Filters">
            <Funnel size={16} />
          </button>
          <button className="icon-btn" onClick={openSettings} title="Settings" aria-label="Settings">
            <Settings size={16} />
          </button>
        </div>
      </div>

      {showFilters && (
        <section className="filters-panel">
          <div className="filters-group">
            <div className="label">Filter by color</div>
            <div className="swatches">
              {COLORS.map((color) => (
                <button
                  key={`filter-${color}`}
                  className={`swatch ${color === "none" ? "none" : ""} ${activeColorFilters.includes(color) ? "active" : ""}`}
                  style={color !== "none" ? { background: color === "gold" ? "#f2b81c" : color === "orange" ? "#ff6600" : color === "pink" ? "#f30074" : color === "purple" ? "#7f33d4" : "#3f7fdf" } : {}}
                  onClick={() => toggleColorFilter(color)}
                >
                  {color === "none" ? "None" : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="filters-group">
            <div className="label">Show columns</div>
            <div className="column-toggles">
              {doc.columns.map((col) => (
                <button
                  key={`col-toggle-${col.id}`}
                  className={`column-toggle ${visibleColumnIds.includes(col.id) ? "is-visible" : "is-hidden"}`}
                  onClick={() => toggleColumnVisibility(col.id)}
                >
                  {visibleColumnIds.includes(col.id) ? <Eye size={12} className="chip-check" /> : <EyeOff size={12} className="chip-check" />}
                  {col.title}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {missingDataSource && (
        <div className="missing-banner">
          <div className="missing-title">Data source not found.</div>
          <div className="missing-body">Current path: <code>{missingDataSource.path}</code></div>
          <div className="missing-body">Open Settings and fix the data source path, or reset to default to use `dropboard.default.json` in this folder.</div>
          <div className="missing-actions">
            <button className="save" onClick={openSettings}>Open Settings</button>
            <button className="modal-close" onClick={useDefaultDataSource}>Use Default Path</button>
          </div>
        </div>
      )}

      {isAddOpen && (
        <div className="modal-overlay" onClick={() => setIsAddOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Add Card</h3>
              <button className="modal-close" onClick={() => setIsAddOpen(false)}>Cancel</button>
            </div>
            <input className="field modal-field" placeholder="Task title" value={draftCard.title} onChange={(e) => setDraftCard((prev) => ({ ...prev, title: e.target.value }))} />
            <textarea className="field modal-field" placeholder="What needs to happen?" value={draftCard.description} onChange={(e) => setDraftCard((prev) => ({ ...prev, description: e.target.value }))} />
            <input className="field modal-field" placeholder="Optional external link (https://...)" value={draftCard.externalUrl} onChange={(e) => setDraftCard((prev) => ({ ...prev, externalUrl: e.target.value }))} />
            <select className="field modal-field" value={draftCard.columnId} onChange={(e) => setDraftCard((prev) => ({ ...prev, columnId: e.target.value }))}>
              {doc.columns.map((col) => <option key={col.id} value={col.id}>{col.title}</option>)}
            </select>
            <div className="label">Color</div>
            <div className="swatches modal-swatches">
              {COLORS.map((color) => (
                <button
                  key={color}
                  className={`swatch ${color === "none" ? "none" : ""} ${draftCard.color === color ? "active" : ""}`}
                  style={color !== "none" ? { background: color === "gold" ? "#f2b81c" : color === "orange" ? "#ff6600" : color === "pink" ? "#f30074" : color === "purple" ? "#7f33d4" : "#3f7fdf" } : {}}
                  onClick={() => setDraftCard((prev) => ({ ...prev, color }))}
                >
                  {color === "none" ? "None" : ""}
                </button>
              ))}
            </div>
            <button className="save" onClick={onAddCard}>Save</button>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Settings</h3>
              <button className="modal-close" onClick={() => setIsSettingsOpen(false)}>Close</button>
            </div>

            <div className="label">Dashboard Title</div>
            <input
              className="field modal-field"
              value={settingsDraft.boardName}
              onChange={(e) => setSettingsDraft((prev) => ({ ...prev, boardName: e.target.value }))}
            />

            <div className="label">Data Source Path</div>
            <input
              className="field modal-field"
              value={settingsDraft.dataSourcePath}
              onChange={(e) => setSettingsDraft((prev) => ({ ...prev, dataSourcePath: e.target.value }))}
            />
            <div className="meta">Blank means default local file in app folder. Use absolute path for shared iCloud/OneDrive JSON.</div>
            <div className="settings-path-actions">
              <button className="modal-close" onClick={testDataSourcePath}>Test Path</button>
            </div>
            {pathValidationMsg && <div className={`meta ${pathValidationKind === "ok" ? "meta-ok" : pathValidationKind === "error" ? "meta-error" : ""}`}>{pathValidationMsg}</div>}

            <div className="settings-columns-head">
              <div className="label">Columns</div>
            </div>

            <Droppable droppableId="settings-columns-droppable" type="SETTINGS_COLUMN">
              {(provided) => (
                <div className="settings-columns" ref={provided.innerRef} {...provided.droppableProps}>
                  {settingsDraft.columns.map((col, idx) => (
                    <Draggable key={col.id} draggableId={`settings-${col.id}`} index={idx}>
                      {(dragProvided) => (
                        <div
                          className="settings-col-row"
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                        >
                          <span
                            className="settings-drag-handle"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                          >
                            ⋮⋮
                          </span>
                          <input
                            className="field"
                            value={col.title}
                            onChange={(e) => setSettingsDraft((prev) => ({
                              ...prev,
                              columns: prev.columns.map((c) => c.id === col.id ? { ...c, title: e.target.value } : c)
                            }))}
                          />
                          <button className="modal-close settings-remove" onClick={() => removeSettingColumn(col.id)} disabled={settingsDraft.columns.length <= 1}>Remove</button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
            <button className="modal-close settings-add-column" onClick={addSettingColumn}>+ Add Column</button>

            <div className="settings-actions">
              <button className="save" onClick={saveSettings}>Save Settings</button>
            </div>
            {allowDeleteBoard ? (
              <div className="settings-danger-zone">
                <div className="meta meta-error">
                  Danger zone: deleting this board removes it from the app{boardMode === "linked" ? " but keeps the linked JSON file." : " and deletes its local board file."}
                </div>
                <button className="danger-btn" onClick={deleteBoard}>Delete Board</button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="board-wrap" onClick={handleDeselectCard}>
          <div className="board">
            {shownColumns.map((col) => {
              const cards = filteredCardsByColumn[col.id] || [];
              return (
                <Droppable droppableId={col.id} key={col.id} type="CARD">
                  {(provided) => (
                    <section className="column" ref={provided.innerRef} {...provided.droppableProps}>
                      <div className="column-header">
                        <span>{col.title}</span>
                        <span>{cards.length}</span>
                      </div>
                      {col.id === shownColumns[0]?.id && (
                        <button className="column-add-btn" onClick={(e) => { e.stopPropagation(); openAddModal(); }}>+ Add card</button>
                      )}
                      <div className="drop-area">
                        {cards.map((card, index) => (
                          <Draggable draggableId={card.id} index={index} key={card.id}>
                            {(dragProvided) => (
                              <article
                                className={`card ${card.color !== "none" ? `color-${card.color}` : ""} ${selectedId === card.id ? "is-selected" : ""}`}
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                onClick={async (e) => { e.stopPropagation(); await handleSelectCard(card.id); }}
                              >
                                <h3 className="card-title">{card.title || "Untitled"}</h3>
                                <div
                                  className="card-desc"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdownInline(card.description || "") }}
                                />
                                {asSafeExternalUrl(card.externalUrl) && (
                                  <a
                                    className="card-link"
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
      <section className="details" onClick={(e) => e.stopPropagation()}>
        <h2>Card Details</h2>
        <input
          className="field"
          placeholder="Task title"
          value={selected.title || ""}
          onChange={(e) => selected && setDoc((prev) => {
            setSelectedDirty(true);
            return { ...prev, cards: prev.cards.map((c) => c.id === selected.id ? { ...c, title: e.target.value, updatedAt: todayIso() } : c) };
          })}
          onBlur={commitSelectedIfDirty}
        />
        <textarea
          className="field"
          placeholder="What needs to happen?"
          value={selected.description || ""}
          onChange={(e) => selected && setDoc((prev) => {
            setSelectedDirty(true);
            return { ...prev, cards: prev.cards.map((c) => c.id === selected.id ? { ...c, description: e.target.value, updatedAt: todayIso() } : c) };
          })}
          onBlur={commitSelectedIfDirty}
        />
        <input
          className="field"
          placeholder="Optional external link (https://...)"
          value={selected.externalUrl || ""}
          onChange={(e) => selected && setDoc((prev) => {
            setSelectedDirty(true);
            return { ...prev, cards: prev.cards.map((c) => c.id === selected.id ? { ...c, externalUrl: e.target.value, updatedAt: todayIso() } : c) };
          })}
          onBlur={commitSelectedIfDirty}
        />
        <select
          className="field"
          value={selected.columnId || ""}
          onChange={(e) => moveSelectedToColumn(e.target.value)}
        >
          {doc.columns.map((col) => (
            <option key={col.id} value={col.id}>{col.title}</option>
          ))}
        </select>

        <div className="label">Color</div>
        <div className="swatches">
          {COLORS.map((color) => (
            <button
              key={color}
              className={`swatch ${color === "none" ? "none" : ""} ${selected?.color === color ? "active" : ""}`}
              style={color !== "none" ? { background: color === "gold" ? "#f2b81c" : color === "orange" ? "#ff6600" : color === "pink" ? "#f30074" : color === "purple" ? "#7f33d4" : "#3f7fdf" } : {}}
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
        <button className="danger-btn" onMouseDown={(e) => e.preventDefault()} onClick={deleteSelectedCard}>Delete card</button>
      </section>
      )}
      </DragDropContext>
    </div>
  );
}
