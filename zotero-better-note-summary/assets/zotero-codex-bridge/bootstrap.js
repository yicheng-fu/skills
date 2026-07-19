"use strict";

var bridgeTimer = null;
var bridgeBusy = false;

const BRIDGE_ROOT = "/tmp/zotero-codex-bridge";
const REQUEST_DIR = `${BRIDGE_ROOT}/requests`;
const RESPONSE_DIR = `${BRIDGE_ROOT}/responses`;

// Zotero's bootstrap sandbox already exposes Cc/Ci. Use plugin-specific names
// to avoid a top-level lexical redeclaration error during installation.
const CodexCc = Components.classes;
const CodexCi = Components.interfaces;

function install() {}

async function startup() {
  await Zotero.initializationPromise;
  ensureBridgeDirs();
  startBridgeTimer();
  log("started");
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  stopBridgeTimer();
}

function uninstall() {}

function startBridgeTimer() {
  if (bridgeTimer) {
    return;
  }
  bridgeTimer = CodexCc["@mozilla.org/timer;1"].createInstance(CodexCi.nsITimer);
  bridgeTimer.initWithCallback(
    () => {
      if (bridgeBusy) {
        return;
      }
      bridgeBusy = true;
      processRequests()
        .catch((error) => logError(error))
        .finally(() => {
          bridgeBusy = false;
        });
    },
    1000,
    CodexCi.nsITimer.TYPE_REPEATING_SLACK,
  );
}

function stopBridgeTimer() {
  if (bridgeTimer) {
    bridgeTimer.cancel();
    bridgeTimer = null;
  }
}

function log(message) {
  Zotero.debug(`[CodexZoteroBridge] ${message}`);
}

function logError(error) {
  if (error && error.stack) {
    Zotero.logError(`[CodexZoteroBridge] ${error.stack}`);
  } else {
    Zotero.logError(`[CodexZoteroBridge] ${error}`);
  }
}

function localFile(path) {
  const file = CodexCc["@mozilla.org/file/local;1"].createInstance(CodexCi.nsIFile);
  file.initWithPath(path);
  return file;
}

function ensureDir(path) {
  const file = localFile(path);
  if (file.exists()) {
    if (!file.isDirectory()) {
      throw new Error(`${path} exists but is not a directory`);
    }
    return;
  }
  file.create(CodexCi.nsIFile.DIRECTORY_TYPE, 0o755);
}

function ensureBridgeDirs() {
  ensureDir(BRIDGE_ROOT);
  ensureDir(REQUEST_DIR);
  ensureDir(RESPONSE_DIR);
}

function listJsonFiles(path) {
  const dir = localFile(path);
  const files = [];
  if (!dir.exists() || !dir.isDirectory()) {
    return files;
  }

  const entries = dir.directoryEntries;
  while (entries.hasMoreElements()) {
    const file = entries.getNext().QueryInterface(CodexCi.nsIFile);
    if (file.isFile() && file.leafName.endsWith(".json")) {
      files.push(file);
    }
  }

  files.sort((a, b) => a.leafName.localeCompare(b.leafName));
  return files;
}

function readText(path) {
  const file = localFile(path);
  const stream = CodexCc["@mozilla.org/network/file-input-stream;1"].createInstance(
    CodexCi.nsIFileInputStream,
  );
  stream.init(file, 0x01, 0o444, 0);

  const converter = CodexCc[
    "@mozilla.org/intl/converter-input-stream;1"
  ].createInstance(CodexCi.nsIConverterInputStream);
  converter.init(stream, "UTF-8", 0, 0);

  let result = "";
  const chunk = {};
  while (converter.readString(0xffffffff, chunk) !== 0) {
    result += chunk.value;
  }

  converter.close();
  stream.close();
  return result;
}

function writeText(path, text) {
  const file = localFile(path);
  if (!file.exists()) {
    file.create(CodexCi.nsIFile.NORMAL_FILE_TYPE, 0o644);
  }

  const stream = CodexCc["@mozilla.org/network/file-output-stream;1"].createInstance(
    CodexCi.nsIFileOutputStream,
  );
  stream.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);

  const converter = CodexCc[
    "@mozilla.org/intl/converter-output-stream;1"
  ].createInstance(CodexCi.nsIConverterOutputStream);
  converter.init(stream, "UTF-8", 0, 0);
  converter.writeString(text);
  converter.close();
  stream.close();
}

function writeResponse(id, payload) {
  const tempName = `${id}.json.tmp`;
  const finalName = `${id}.json`;
  const tempPath = `${RESPONSE_DIR}/${tempName}`;
  const tempFile = localFile(tempPath);

  writeText(tempPath, JSON.stringify(payload, null, 2));
  tempFile.moveTo(localFile(RESPONSE_DIR), finalName);
}

function removeFile(file) {
  if (file && file.exists()) {
    file.remove(false);
  }
}

function normalizeItem(item) {
  let current = item;

  while (current) {
    if (typeof current.isAttachment === "function" && current.isAttachment() && current.parentItem) {
      current = current.parentItem;
      continue;
    }
    if (typeof current.isNote === "function" && current.isNote() && current.parentItem) {
      current = current.parentItem;
      continue;
    }
    if (typeof current.isAnnotation === "function" && current.isAnnotation() && current.parentItem) {
      current = current.parentItem;
      continue;
    }
    break;
  }

  return current;
}

function serializeCreators(item) {
  if (!item || typeof item.getCreators !== "function") {
    return [];
  }
  return item.getCreators().map((creator) => ({
    firstName: creator.firstName || "",
    lastName: creator.lastName || "",
    name: creator.name || "",
    creatorType: creator.creatorType || "",
  }));
}

async function serializeBestAttachment(item) {
  if (!item || typeof item.getBestAttachment !== "function") {
    return null;
  }
  const attachment = await item.getBestAttachment();
  if (!attachment) {
    return null;
  }

  let path = "";
  if (typeof attachment.getFilePathAsync === "function") {
    try {
      path = (await attachment.getFilePathAsync()) || "";
    } catch (error) {
      log(`failed to resolve attachment path for ${attachment.key}: ${error}`);
    }
  }

  return {
    id: attachment.id,
    key: attachment.key,
    title: attachment.getField ? attachment.getField("title") || "" : "",
    path,
  };
}

async function serializeItem(item) {
  const typeName = item && typeof item.itemTypeID === "number"
    ? Zotero.ItemTypes.getName(item.itemTypeID)
    : "";
  const date = item && item.getField ? item.getField("date") || "" : "";
  const year = item && item.getField ? item.getField("year") || "" : "";

  return {
    id: item.id,
    key: item.key,
    libraryID: item.libraryID,
    itemType: typeName,
    title: item.getField ? item.getField("title") || "" : "",
    abstractNote: item.getField ? item.getField("abstractNote") || "" : "",
    DOI: item.getField ? item.getField("DOI") || "" : "",
    url: item.getField ? item.getField("url") || "" : "",
    date,
    year: year || date.slice(0, 4),
    creators: serializeCreators(item),
    tags: item.getTags ? item.getTags().map((tag) => tag.tag) : [],
    bestAttachment: await serializeBestAttachment(item),
  };
}

function serializeNoteItem(noteItem) {
  const noteHTML = noteItem && typeof noteItem.getNote === "function"
    ? noteItem.getNote() || ""
    : "";

  return {
    id: noteItem.id,
    key: noteItem.key,
    libraryID: noteItem.libraryID,
    parentID: noteItem.parentID,
    title: noteItem.getNoteTitle ? noteItem.getNoteTitle() : "",
    noteHTML,
    noteText: htmlToText(noteHTML),
  };
}

function getSelectedItemsOrThrow() {
  const win = Zotero.getMainWindow();
  const pane = win && win.ZoteroPane;
  if (!pane || typeof pane.getSelectedItems !== "function") {
    throw new Error("Zotero pane is not available");
  }

  const selectedItems = pane.getSelectedItems();
  if (!selectedItems || selectedItems.length === 0) {
    throw new Error("No Zotero item is selected");
  }
  if (selectedItems.length !== 1) {
    throw new Error("Select exactly one Zotero item");
  }

  return selectedItems[0];
}

async function getSelectedTopLevelItem() {
  return normalizeItem(getSelectedItemsOrThrow());
}

function findItemByKey(key, libraryID) {
  if (!key) {
    return null;
  }

  if (libraryID) {
    return Zotero.Items.getByLibraryAndKey(Number(libraryID), key);
  }

  const libraries = Zotero.Libraries.getAll();
  for (const library of libraries) {
    const item = Zotero.Items.getByLibraryAndKey(library.libraryID, key);
    if (item) {
      return item;
    }
  }

  return null;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fallbackMarkdownToHtml(markdown) {
  const blocks = String(markdown)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      if (block.startsWith("### ")) {
        return `<h3>${escapeHtml(block.slice(4))}</h3>`;
      }
      if (block.startsWith("## ")) {
        return `<h2>${escapeHtml(block.slice(3))}</h2>`;
      }
      if (block.startsWith("# ")) {
        return `<h1>${escapeHtml(block.slice(2))}</h1>`;
      }

      const lines = block
        .split("\n")
        .map((line) => escapeHtml(line.trim()))
        .filter(Boolean);
      return `<p>${lines.join("<br />")}</p>`;
    })
    .join("\n");
}

async function markdownToHtml(markdown) {
  if (
    Zotero.BetterNotes &&
    Zotero.BetterNotes.api &&
    Zotero.BetterNotes.api.convert &&
    typeof Zotero.BetterNotes.api.convert.md2html === "function"
  ) {
    return await Zotero.BetterNotes.api.convert.md2html(markdown);
  }
  return fallbackMarkdownToHtml(markdown);
}

function buildFinalMarkdown(markdown, noteTitle) {
  const trimmed = String(markdown || "").trim();
  if (!trimmed) {
    throw new Error("Markdown content is empty");
  }

  if (noteTitle) {
    return `# ${String(noteTitle).trim()}\n\n${trimmed}`;
  }
  return trimmed;
}

async function openNoteItem(noteItem) {
  try {
    if (
      Zotero.BetterNotes &&
      Zotero.BetterNotes.hooks &&
      typeof Zotero.BetterNotes.hooks.onOpenNote === "function"
    ) {
      await Zotero.BetterNotes.hooks.onOpenNote(noteItem.id, "tab");
    } else {
      await Zotero.getMainWindow().ZoteroPane.selectItem(noteItem.id);
    }
  } catch (error) {
    log(`failed to open note ${noteItem.id}: ${error}`);
  }
}

function getTargetParentItem(payload) {
  let parentItem = null;
  if (payload.parentKey) {
    parentItem = findItemByKey(payload.parentKey, payload.libraryID);
  }

  return parentItem;
}

async function getRequestParentItem(payload) {
  let parentItem = getTargetParentItem(payload);
  if (!parentItem && payload.selected) {
    parentItem = await getSelectedTopLevelItem();
  }

  parentItem = normalizeItem(parentItem);
  if (!parentItem) {
    throw new Error("Parent item is required");
  }
  return parentItem;
}

function getChildNoteItems(parentItem) {
  if (!parentItem || typeof parentItem.getNotes !== "function") {
    return [];
  }

  const noteIDs = parentItem.getNotes() || [];
  return Zotero.Items.get(noteIDs)
    .filter((item) => item && typeof item.isNote === "function" && item.isNote());
}

async function handlePing() {
  return {
    bridge: "codex-zotero-bridge",
    version: "0.2.2",
    betterNotesAvailable: Boolean(
      Zotero.BetterNotes &&
        Zotero.BetterNotes.api &&
        Zotero.BetterNotes.api.convert &&
        typeof Zotero.BetterNotes.api.convert.md2html === "function",
    ),
  };
}

async function handleListNotes(payload) {
  const parentItem = await getRequestParentItem(payload);
  const notes = getChildNoteItems(parentItem).map((noteItem) => {
    const serialized = serializeNoteItem(noteItem);
    if (!payload.includeContent) {
      delete serialized.noteHTML;
      delete serialized.noteText;
    }
    return serialized;
  });

  return {
    notes,
    parent: {
      id: parentItem.id,
      key: parentItem.key,
      title: parentItem.getField ? parentItem.getField("title") || "" : "",
    },
  };
}

async function handleGetSelectedItem() {
  const item = await getSelectedTopLevelItem();
  return {
    item: await serializeItem(item),
  };
}

async function handleGetItem(payload) {
  const item = findItemByKey(payload.key, payload.libraryID);
  if (!item) {
    throw new Error(`Cannot find Zotero item with key ${payload.key}`);
  }
  return {
    item: await serializeItem(normalizeItem(item)),
  };
}

async function handleCreateNote(payload) {
  const parentItem = await getRequestParentItem(payload);
  const finalMarkdown = buildFinalMarkdown(payload.markdown, payload.noteTitle);
  const html = await markdownToHtml(finalMarkdown);
  const noteItem = new Zotero.Item("note");
  noteItem.libraryID = parentItem.libraryID;
  noteItem.parentID = parentItem.id;
  noteItem.setNote(html);
  await noteItem.saveTx();

  if (payload.openInWindow) {
    await openNoteItem(noteItem);
  }

  return {
    note: serializeNoteItem(noteItem),
    parent: {
      id: parentItem.id,
      key: parentItem.key,
      title: parentItem.getField ? parentItem.getField("title") || "" : "",
    },
  };
}

async function handleUpdateNote(payload) {
  const noteItem = findItemByKey(payload.noteKey, payload.libraryID);
  if (!noteItem || typeof noteItem.isNote !== "function" || !noteItem.isNote()) {
    throw new Error(`Cannot find Zotero note with key ${payload.noteKey}`);
  }

  const finalMarkdown = buildFinalMarkdown(payload.markdown, payload.noteTitle);
  const html = await markdownToHtml(finalMarkdown);
  noteItem.setNote(html);
  await noteItem.saveTx();

  if (payload.openInWindow) {
    await openNoteItem(noteItem);
  }

  const parentItem = noteItem.parentItem || null;
  return {
    note: serializeNoteItem(noteItem),
    parent: parentItem
      ? {
          id: parentItem.id,
          key: parentItem.key,
          title: parentItem.getField ? parentItem.getField("title") || "" : "",
        }
      : null,
  };
}

async function dispatchRequest(request) {
  const payload = request.payload || {};

  switch (request.command) {
    case "ping":
      return await handlePing();
    case "get-selected-item":
      return await handleGetSelectedItem();
    case "get-item":
      return await handleGetItem(payload);
    case "list-notes":
      return await handleListNotes(payload);
    case "create-note":
      return await handleCreateNote(payload);
    case "update-note":
      return await handleUpdateNote(payload);
    default:
      throw new Error(`Unsupported command: ${request.command}`);
  }
}

async function processRequestFile(file) {
  let request = null;

  try {
    request = JSON.parse(readText(file.path));
    if (!request.id) {
      throw new Error("Request id is missing");
    }

    const result = await dispatchRequest(request);
    writeResponse(request.id, {
      ok: true,
      result,
    });
  } catch (error) {
    const responseID = request && request.id ? request.id : file.leafName.replace(/\.json$/, "");
    writeResponse(responseID, {
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
    logError(error);
  } finally {
    removeFile(file);
  }
}

async function processRequests() {
  ensureBridgeDirs();
  const files = listJsonFiles(REQUEST_DIR);
  for (const file of files) {
    await processRequestFile(file);
  }
}
