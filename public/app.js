const fileInput = document.querySelector("#file-input");
const uploadForm = document.querySelector("#upload-form");
const uploadToken = document.querySelector("#upload-token");
const expirySelect = document.querySelector("#expiry-select");
const dropzone = document.querySelector("#dropzone");
const selectedFiles = document.querySelector("#selected-files");
const feedbackStrip = document.querySelector("#feedback-strip");
const progressShell = document.querySelector("#progress-shell");
const progressBar = document.querySelector("#progress-bar");
const fileGrid = document.querySelector("#file-grid");
const emptyState = document.querySelector("#empty-state");
const refreshButton = document.querySelector("#refresh-button");
const searchInput = document.querySelector("#search-input");
const fileTemplate = document.querySelector("#file-card-template");
const fileCount = document.querySelector("#file-count");
const storageUsed = document.querySelector("#storage-used");
const uploadMode = document.querySelector("#upload-mode");
const limitCopy = document.querySelector("#limit-copy");
const uploadButton = document.querySelector("#upload-button");

let fileIndex = [];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatExpiry(expiresAt) {
  if (!expiresAt) {
    return "Never expires";
  }

  const remainingMs = new Date(expiresAt).getTime() - Date.now();

  if (remainingMs <= 0) {
    return "Expired";
  }

  const hours = Math.floor(remainingMs / 3600000);

  if (hours < 1) {
    return `Expires in ${Math.max(1, Math.round(remainingMs / 60000))} min`;
  }

  if (hours < 48) {
    return `Expires in ${hours} h`;
  }

  return `Expires in ${Math.round(hours / 24)} days`;
}

function setFeedback(message, type = "") {
  feedbackStrip.textContent = message;
  feedbackStrip.className = `feedback-strip ${type}`.trim();
}

function updateSelectionPreview() {
  const files = Array.from(fileInput.files || []);
  selectedFiles.innerHTML = "";

  for (const file of files) {
    const item = document.createElement("li");
    item.textContent = `${file.name} - ${formatBytes(file.size)}`;
    selectedFiles.appendChild(item);
  }

  if (!files.length) {
    const item = document.createElement("li");
    item.textContent = "No files queued yet.";
    selectedFiles.appendChild(item);
  }
}

async function deleteFile(file, button) {
  if (!window.confirm(`Delete ${file.originalName}? The download link stops working.`)) {
    return;
  }

  button.disabled = true;

  try {
    const response = await fetch(`/api/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
      headers: uploadToken.value.trim() ? { "x-upload-token": uploadToken.value.trim() } : {}
    });
    const payload = await response.json();

    if (!response.ok) {
      setFeedback(payload.error || "Delete failed.", "error");
      button.disabled = false;
      return;
    }

    setFeedback(payload.message || "File deleted.", "success");
    await loadFiles();
  } catch (_error) {
    setFeedback("Delete failed because the server could not be reached.", "error");
    button.disabled = false;
  }
}

function renderFiles() {
  const query = searchInput.value.trim().toLowerCase();
  const visibleFiles = fileIndex.filter((file) => {
    return file.originalName.toLowerCase().includes(query);
  });

  fileGrid.innerHTML = "";
  emptyState.classList.toggle("hidden", visibleFiles.length > 0);

  if (!visibleFiles.length) {
    emptyState.querySelector("strong").textContent = fileIndex.length
      ? "No matches found."
      : "No files yet.";
    emptyState.querySelector("p").textContent = fileIndex.length
      ? "Try a different search, or refresh if you uploaded something a moment ago."
      : "Your first upload will show up here with a ready-to-share download link.";
  }

  for (const file of visibleFiles) {
    const node = fileTemplate.content.firstElementChild.cloneNode(true);
    const fullLink = new URL(file.downloadPath, window.location.origin).toString();

    node.querySelector(".file-name").textContent = file.originalName;
    node.querySelector(".file-meta").textContent = `${file.sizeLabel} - ${formatDate(file.uploadedAt)}`;
    node.querySelector(".file-expiry").textContent = formatExpiry(file.expiresAt);

    node.querySelector(".file-download").href = file.downloadPath;

    const copyButton = node.querySelector(".file-copy");
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(fullLink);
        copyButton.textContent = "Copied";
        window.setTimeout(() => {
          copyButton.textContent = "Copy link";
        }, 1200);
      } catch (_error) {
        setFeedback("Clipboard access failed. Copy the download link manually from your browser.", "error");
      }
    });

    const deleteButton = node.querySelector(".file-delete");
    deleteButton.addEventListener("click", () => deleteFile(file, deleteButton));

    fileGrid.appendChild(node);
  }

  fileCount.textContent = String(fileIndex.length);
  storageUsed.textContent = formatBytes(fileIndex.reduce((sum, file) => sum + file.size, 0));
}

async function loadFiles() {
  refreshButton.disabled = true;

  try {
    const response = await fetch("/api/files");
    const payload = await response.json();

    fileIndex = payload.files || [];
    uploadMode.textContent = payload.uploadProtected ? "Token" : "Open";
    limitCopy.textContent = `Upload up to 12 files at once. Max ${payload.maxFileSizeMb} MB per file.`;
    renderFiles();
  } catch (_error) {
    setFeedback("Could not load the file list right now.", "error");
  } finally {
    refreshButton.disabled = false;
  }
}

function setUploadingState(isUploading) {
  uploadButton.disabled = isUploading;
  fileInput.disabled = isUploading;
  uploadToken.disabled = isUploading;
  expirySelect.disabled = isUploading;
  progressShell.classList.toggle("hidden", !isUploading);

  if (!isUploading) {
    progressBar.style.width = "0%";
  }
}

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!fileInput.files || !fileInput.files.length) {
    setFeedback("Pick at least one file before uploading.", "error");
    return;
  }

  const formData = new FormData();
  for (const file of fileInput.files) {
    formData.append("files", file);
  }

  formData.append("expiryHours", expirySelect.value);

  setFeedback("Uploading files...");
  setUploadingState(true);

  const request = new XMLHttpRequest();
  request.open("POST", "/api/upload");

  // The server checks the token before it parses the body, so it has to
  // travel as a header, not a form field.
  if (uploadToken.value.trim()) {
    request.setRequestHeader("x-upload-token", uploadToken.value.trim());
  }

  request.upload.addEventListener("progress", (progressEvent) => {
    if (!progressEvent.lengthComputable) {
      return;
    }

    const percent = (progressEvent.loaded / progressEvent.total) * 100;
    progressBar.style.width = `${percent.toFixed(1)}%`;
  });

  request.addEventListener("load", async () => {
    setUploadingState(false);

    try {
      const payload = JSON.parse(request.responseText || "{}");

      if (request.status >= 400) {
        setFeedback(payload.error || "Upload failed.", "error");
        return;
      }

      setFeedback(payload.message || "Upload complete.", "success");
      fileInput.value = "";
      updateSelectionPreview();
      await loadFiles();
    } catch (_error) {
      setFeedback("Upload finished, but the response could not be parsed.", "error");
    }
  });

  request.addEventListener("error", () => {
    setUploadingState(false);
    setFeedback("Upload failed because the server could not be reached.", "error");
  });

  request.send(formData);
});

fileInput.addEventListener("change", updateSelectionPreview);
searchInput.addEventListener("input", renderFiles);
refreshButton.addEventListener("click", loadFiles);

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
}

updateSelectionPreview();
loadFiles();
