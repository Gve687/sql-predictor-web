/**
 * Controlador principal de la interfaz de usuario para SQL Predictor.
 */

document.addEventListener("DOMContentLoaded", () => {
  const predictor = new window.SQLPredictor();

  // Referencias al DOM
  const editor = document.getElementById("sqlEditor");
  const lineNumbers = document.getElementById("lineNumbers");
  const popup = document.getElementById("autocompletePopup");
  const livePredictions = document.getElementById("livePredictions");
  const dictStatus = document.getElementById("dictStatus");
  const cursorPos = document.getElementById("cursorPos");

  const fileInput = document.getElementById("dictFileInput");
  const btnResetDict = document.getElementById("btnResetDict");
  const btnClearEditor = document.getElementById("btnClearEditor");
  const quickChips = document.querySelectorAll(".chip");

  // Estado del autocompletado
  let currentPredictions = [];
  let selectedIndex = 0;
  let popupOpen = false;

  // Etiquetas legibles por tipo de token
  const KIND_LABELS = {
    keyword: { short: "KW", cls: "kind-keyword" },
    table: { short: "TBL", cls: "kind-table" },
    column: { short: "COL", cls: "kind-column" },
    value: { short: "VAL", cls: "kind-value" },
    ngram: { short: "AI", cls: "kind-ngram" }
  };

  /* ---------- Carga del diccionario ---------- */
  async function loadDefaultDictionary() {
    try {
      const response = await fetch("data/LLMFINETUNNING.txt");
      if (!response.ok) throw new Error("No se pudo leer data/LLMFINETUNNING.txt");
      const text = await response.text();
      trainAndRefresh(text, "LLMFINETUNNING.txt");
    } catch (_err) {
      // Respaldo embebido para cuando se abre index.html directamente (file://)
      if (window.DEFAULT_CORPUS) {
        trainAndRefresh(window.DEFAULT_CORPUS, "LLMFINETUNNING.txt (local)");
      } else {
        dictStatus.textContent = "Sin diccionario cargado";
      }
    }
  }

  function trainAndRefresh(corpusText, sourceName) {
    predictor.train(corpusText);
    dictStatus.textContent = `Diccionario: ${sourceName}`;
    updatePredictions(false);
  }

  /* ---------- Predicciones y menú emergente ---------- */
  function updatePredictions(openPopup = true) {
    const caretIndex = editor.selectionStart;
    const textBefore = editor.value.slice(0, caretIndex);
    const result = predictor.predict(textBefore, 8);

    currentPredictions = result.predictions;
    selectedIndex = 0;

    renderSidebarPredictions(currentPredictions);

    if (openPopup && currentPredictions.length > 0 && document.activeElement === editor) {
      renderPopup(currentPredictions);
      positionPopup();
      popup.classList.remove("hidden");
      popupOpen = true;
    } else {
      closePopup();
    }
  }

  function renderSidebarPredictions(items) {
    livePredictions.innerHTML = "";
    if (items.length === 0) {
      livePredictions.innerHTML = '<li class="empty-state">Sin sugerencias para el contexto actual.</li>';
      return;
    }

    items.forEach((item) => {
      const kind = KIND_LABELS[item.type] || KIND_LABELS.ngram;
      const li = document.createElement("li");
      li.className = "pred-row";
      li.innerHTML = `
        <div class="pred-row-top">
          <span class="pred-token">${escapeHtml(item.token)}</span>
          <span class="pred-meta">
            <span class="kind-tag ${kind.cls}">${kind.short}</span>
            <span>${item.probability}%</span>
          </span>
        </div>
        <div class="prob-bar-track">
          <div class="prob-bar-fill" style="width: ${item.probability}%"></div>
        </div>
      `;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applySuggestion(item);
      });
      livePredictions.appendChild(li);
    });
  }

  function renderPopup(items) {
    popup.innerHTML = "";
    items.forEach((item, index) => {
      const kind = KIND_LABELS[item.type] || KIND_LABELS.ngram;
      const div = document.createElement("div");
      div.className = `ac-item${index === selectedIndex ? " selected" : ""}`;
      div.setAttribute("role", "option");
      div.innerHTML = `
        <span class="ac-left">
          <span class="kind-tag ${kind.cls}">${kind.short}</span>
          <span class="ac-token">${escapeHtml(item.token)}</span>
        </span>
        <span class="ac-right">
          <span class="ac-prob">${item.probability}%</span>
        </span>
      `;
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applySuggestion(item);
      });
      popup.appendChild(div);
    });
  }

  function updatePopupSelection() {
    const nodes = popup.querySelectorAll(".ac-item");
    nodes.forEach((node, idx) => {
      node.classList.toggle("selected", idx === selectedIndex);
      if (idx === selectedIndex) {
        node.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function closePopup() {
    popup.classList.add("hidden");
    popupOpen = false;
  }

  function applySuggestion(item) {
    const needsSpace = ![",", "(", ")", ";"].includes(item.token);
    const suffix = needsSpace ? " " : "";
    insertAtCursor(item.token + suffix, item.replaceLength);
    updatePredictions(true);
  }

  function insertAtCursor(text, replaceLength = 0) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = editor.value.slice(0, Math.max(0, start - replaceLength));
    const after = editor.value.slice(end);

    editor.value = before + text + after;
    const newCaret = before.length + text.length;
    editor.focus();
    editor.setSelectionRange(newCaret, newCaret);

    updateLineNumbers();
    updateCursorPosition();
  }

  /* ---------- Coordenadas exactas del cursor para el popup ---------- */
  function positionPopup() {
    const coords = getCaretCoordinates(editor, editor.selectionStart);
    const stageRect = editor.parentElement.getBoundingClientRect();

    let top = coords.top - editor.scrollTop + 26;
    let left = coords.left - editor.scrollLeft;

    const popupWidth = 280;
    const popupHeight = 250;

    if (left + popupWidth > stageRect.width) {
      left = Math.max(8, stageRect.width - popupWidth - 12);
    }
    if (top + popupHeight > stageRect.height) {
      top = Math.max(8, coords.top - editor.scrollTop - popupHeight - 6);
    }

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }

  function getCaretCoordinates(textarea, position) {
    const mirror = document.createElement("div");
    const style = window.getComputedStyle(textarea);

    const properties = [
      "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
      "tabSize", "whiteSpace", "wordWrap"
    ];

    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.top = "0";
    mirror.style.left = "-9999px";
    properties.forEach((prop) => {
      mirror.style[prop] = style[prop];
    });

    mirror.textContent = textarea.value.substring(0, position);
    const span = document.createElement("span");
    span.textContent = textarea.value.substring(position) || ".";
    mirror.appendChild(span);

    document.body.appendChild(mirror);
    const coords = { top: span.offsetTop, left: span.offsetLeft };
    document.body.removeChild(mirror);
    return coords;
  }

  /* ---------- Utilidades del editor ---------- */
  function updateLineNumbers() {
    const lines = editor.value.split("\n").length;
    let nums = "";
    for (let i = 1; i <= lines; i++) {
      nums += i + "\n";
    }
    lineNumbers.textContent = nums;
  }

  function updateCursorPosition() {
    const before = editor.value.slice(0, editor.selectionStart);
    const lines = before.split("\n");
    const ln = lines.length;
    const col = lines[lines.length - 1].length + 1;
    cursorPos.textContent = `Ln ${ln}, Col ${col}`;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- Eventos ---------- */
  editor.addEventListener("input", () => {
    updateLineNumbers();
    updateCursorPosition();
    updatePredictions(true);
  });

  editor.addEventListener("scroll", () => {
    lineNumbers.scrollTop = editor.scrollTop;
    if (popupOpen) positionPopup();
  });

  editor.addEventListener("click", () => {
    updateCursorPosition();
    updatePredictions(false);
  });

  editor.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      updatePredictions(true);
      return;
    }

    if (!popupOpen || currentPredictions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % currentPredictions.length;
      updatePopupSelection();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + currentPredictions.length) % currentPredictions.length;
      updatePopupSelection();
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      applySuggestion(currentPredictions[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePopup();
    }
  });

  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== editor) {
      closePopup();
    }
  });

  // Cargar archivo personalizado (.txt o .sql)
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      trainAndRefresh(evt.target.result, file.name);
      editor.focus();
    };
    reader.readAsText(file, "UTF-8");
    fileInput.value = "";
  });

  btnResetDict.addEventListener("click", () => {
    loadDefaultDictionary();
    editor.focus();
  });

  btnClearEditor.addEventListener("click", () => {
    editor.value = "";
    updateLineNumbers();
    updateCursorPosition();
    updatePredictions(false);
    editor.focus();
  });

  quickChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      editor.value = chip.dataset.snippet;
      const len = editor.value.length;
      editor.focus();
      editor.setSelectionRange(len, len);
      updateLineNumbers();
      updateCursorPosition();
      updatePredictions(true);
    });
  });

  // Inicialización
  updateLineNumbers();
  updateCursorPosition();
  loadDefaultDictionary();
});
