const state = {
  proteins: [],
  selections: {
    primary: new Set(),
    test: new Set(),
  },
};

const historyData = new WeakMap();

const elements = {
  fileInput: document.getElementById("fasta-file"),
  fileMeta: document.getElementById("file-meta"),
  primaryList: document.getElementById("primary-list"),
  testList: document.getElementById("test-list"),
  selectionSummary: document.getElementById("selection-summary"),
  compareHint: document.getElementById("compare-hint"),
  compareBtn: document.getElementById("compare-btn"),
  downloadBtn: document.getElementById("download-btn"),
  comparisons: document.getElementById("comparisons"),
  resultsMeta: document.getElementById("results-meta"),
  historyList: document.getElementById("history-list"),
};

const ALIGN_SCORES = {
  match: 1,
  mismatch: -1,
  gap: -1,
};

function parseFasta(text) {
  const lines = text.split(/\r?\n/);
  const proteins = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith(">")) {
      if (current && current.sequence.length) {
        proteins.push(current);
      }
      const name = line.slice(1).trim() || `Sequence ${proteins.length + 1}`;
      current = { name, sequence: "" };
      continue;
    }

    if (!current) {
      continue;
    }

    current.sequence += line.replace(/\s+/g, "");
  }

  if (current && current.sequence.length) {
    proteins.push(current);
  }

  return proteins.map((protein, index) => ({
    id: String(index),
    name: protein.name,
    sequence: protein.sequence.toUpperCase(),
  }));
}

function updateFileMeta(fileName, count) {
  if (!fileName) {
    elements.fileMeta.textContent = "No file loaded.";
    return;
  }
  elements.fileMeta.textContent = `Loaded ${fileName} with ${count} proteins.`;
}

function updateSelectionSummary() {
  const primaryCount = state.selections.primary.size;
  const testCount = state.selections.test.size;
  elements.selectionSummary.textContent = `${primaryCount} primaries - ${testCount} tests`;
  if (primaryCount && testCount) {
    elements.compareHint.textContent = "Ready to compare.";
  } else {
    elements.compareHint.textContent = "Select at least 1 primary and 1 test.";
  }
}

function setEmptyList(listElement, message) {
  listElement.classList.add("empty");
  listElement.textContent = message;
}

function createProteinItem(protein, group) {
  const label = document.createElement("label");
  label.className = "protein-item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = protein.id;
  checkbox.checked = state.selections[group].has(protein.id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.selections[group].add(protein.id);
    } else {
      state.selections[group].delete(protein.id);
    }
    updateSelectionSummary();
  });

  const name = document.createElement("span");
  name.className = "protein-name";
  name.textContent = protein.name;

  const meta = document.createElement("span");
  meta.className = "protein-meta";
  meta.textContent = `(${protein.sequence.length} aa)`;

  label.append(checkbox, name, meta);
  return label;
}

function renderProteinLists() {
  elements.primaryList.innerHTML = "";
  elements.testList.innerHTML = "";
  elements.primaryList.classList.remove("empty");
  elements.testList.classList.remove("empty");

  if (!state.proteins.length) {
    setEmptyList(elements.primaryList, "No proteins found in file.");
    setEmptyList(elements.testList, "No proteins found in file.");
    return;
  }

  for (const protein of state.proteins) {
    elements.primaryList.appendChild(createProteinItem(protein, "primary"));
    elements.testList.appendChild(createProteinItem(protein, "test"));
  }
}

function getSelected(group) {
  return state.proteins.filter((protein) => state.selections[group].has(protein.id));
}

function showEmptyComparisons(message) {
  elements.comparisons.classList.add("empty-state");
  elements.comparisons.textContent = message;
}

function formatNames(selections) {
  return selections.map((protein) => protein.name).join(", ");
}

function addHistoryEntry(primaries, tests) {
  if (!primaries.length || !tests.length) {
    return;
  }

  if (elements.historyList.classList.contains("empty")) {
    elements.historyList.textContent = "";
    elements.historyList.classList.remove("empty");
  }
  const entry = document.createElement("div");
  entry.className = "history-entry";

  const entryData = {
    primaries: primaries.map((protein) => ({
      name: protein.name,
      sequence: protein.sequence,
    })),
    tests: tests.map((protein) => ({
      name: protein.name,
      sequence: protein.sequence,
    })),
  };
  historyData.set(entry, entryData);

  const primaryMeta = document.createElement("div");
  primaryMeta.className = "history-meta";
  const primaryTitle = document.createElement("span");
  primaryTitle.className = "history-title";
  primaryTitle.textContent = "Primary";
  const primaryValues = document.createElement("span");
  primaryValues.className = "history-values";
  primaryValues.textContent = formatNames(primaries);
  primaryMeta.append(primaryTitle, primaryValues);

  const testMeta = document.createElement("div");
  testMeta.className = "history-meta";
  const testTitle = document.createElement("span");
  testTitle.className = "history-title";
  testTitle.textContent = "Test";
  const testValues = document.createElement("span");
  testValues.className = "history-values";
  testValues.textContent = formatNames(tests);
  testMeta.append(testTitle, testValues);

  const notes = document.createElement("textarea");
  notes.className = "history-notes";
  notes.placeholder = "Add notes...";

  const actions = document.createElement("div");
  actions.className = "history-actions";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "history-download";
  downloadBtn.textContent = "Download";
  downloadBtn.addEventListener("click", () => {
    const data = historyData.get(entry);
    if (!data) {
      return;
    }
    const content = buildComparisonsTextWithNotes(
      data.primaries,
      data.tests,
      notes.value
    );
    triggerDownload(content, "comparison.txt");
  });

  actions.append(downloadBtn);
  entry.append(primaryMeta, testMeta, notes, actions);
  elements.historyList.prepend(entry);
}

function resetHistory() {
  elements.historyList.textContent = "No comparisons yet.";
  elements.historyList.classList.add("empty");
}

function alignSequences(primary, test) {
  const rows = primary.length + 1;
  const cols = test.length + 1;
  const scores = Array.from({ length: rows }, () => new Int32Array(cols));
  const trace = Array.from({ length: rows }, () => new Uint8Array(cols));

  for (let i = 1; i < rows; i += 1) {
    scores[i][0] = scores[i - 1][0] + ALIGN_SCORES.gap;
    trace[i][0] = 1;
  }
  for (let j = 1; j < cols; j += 1) {
    scores[0][j] = scores[0][j - 1] + ALIGN_SCORES.gap;
    trace[0][j] = 2;
  }

  for (let i = 1; i < rows; i += 1) {
    const primaryChar = primary[i - 1];
    for (let j = 1; j < cols; j += 1) {
      const testChar = test[j - 1];
      const diagScore =
        scores[i - 1][j - 1] +
        (primaryChar === testChar ? ALIGN_SCORES.match : ALIGN_SCORES.mismatch);
      const upScore = scores[i - 1][j] + ALIGN_SCORES.gap;
      const leftScore = scores[i][j - 1] + ALIGN_SCORES.gap;

      let bestScore = diagScore;
      let direction = 0;
      if (upScore > bestScore) {
        bestScore = upScore;
        direction = 1;
      }
      if (leftScore > bestScore) {
        bestScore = leftScore;
        direction = 2;
      }

      scores[i][j] = bestScore;
      trace[i][j] = direction;
    }
  }

  let i = primary.length;
  let j = test.length;
  const alignedPrimary = [];
  const alignedTest = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && trace[i][j] === 0) {
      alignedPrimary.push(primary[i - 1]);
      alignedTest.push(test[j - 1]);
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || trace[i][j] === 1)) {
      alignedPrimary.push(primary[i - 1]);
      alignedTest.push("-");
      i -= 1;
    } else {
      alignedPrimary.push("-");
      alignedTest.push(test[j - 1]);
      j -= 1;
    }
  }

  return {
    primary: alignedPrimary.reverse().join(""),
    test: alignedTest.reverse().join(""),
  };
}

function createSequenceLine(sequence, comparison) {
  const line = document.createElement("div");
  line.className = "seq-line";

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < sequence.length; index += 1) {
    const char = sequence[index];
    const other = comparison[index];
    const span = document.createElement("span");
    span.className = "aa";

    if (char === "-") {
      span.classList.add("gap");
    } else if (char === other) {
      span.classList.add("match");
    } else {
      span.classList.add("mismatch");
    }

    span.textContent = char;
    fragment.appendChild(span);
  }

  line.appendChild(fragment);
  return line;
}

function createComparisonCard(primary, test, alignment, index) {
  const card = document.createElement("section");
  card.className = "compare-card";
  card.style.animationDelay = `${index * 30}ms`;

  const header = document.createElement("div");
  header.className = "compare-header";
  header.textContent = `Primary: ${primary.name} | Test: ${test.name}`;

  const body = document.createElement("div");
  body.className = "compare-body";

  const grid = document.createElement("div");
  grid.className = "compare-grid";

  const primaryLabel = document.createElement("div");
  primaryLabel.className = "seq-label";
  primaryLabel.textContent = primary.name;

  const testLabel = document.createElement("div");
  testLabel.className = "seq-label";
  testLabel.textContent = test.name;

  const scroll = document.createElement("div");
  scroll.className = "seq-scroll shared";
  scroll.append(
    createSequenceLine(alignment.primary, alignment.test),
    createSequenceLine(alignment.test, alignment.primary)
  );

  grid.append(primaryLabel, scroll, testLabel);
  body.appendChild(grid);

  card.append(header, body);
  return card;
}

function renderComparisons() {
  const primaries = getSelected("primary");
  const tests = getSelected("test");

  if (!primaries.length || !tests.length) {
    showEmptyComparisons("Select at least 1 primary and 1 test.");
    elements.resultsMeta.textContent = "No comparisons yet.";
    return;
  }

  elements.comparisons.innerHTML = "";
  elements.comparisons.classList.remove("empty-state");

  let compareCount = 0;
  primaries.forEach((primary) => {
    tests.forEach((test) => {
      const alignment = alignSequences(primary.sequence, test.sequence);
      elements.comparisons.appendChild(
        createComparisonCard(primary, test, alignment, compareCount)
      );
      compareCount += 1;
    });
  });

  elements.resultsMeta.textContent = `${compareCount} comparisons.`;
}

function buildComparisonsText(primaries, tests) {
  const blocks = [];
  primaries.forEach((primary) => {
    tests.forEach((test) => {
      const alignment = alignSequences(primary.sequence, test.sequence);
      const marker = buildMarkerLine(alignment.primary, alignment.test);
      blocks.push(
        `Primary: ${primary.name}\nTest: ${test.name}\n${alignment.primary}\n${marker}\n${alignment.test}`
      );
    });
  });
  return blocks.join("\n\n");
}

function buildMarkerLine(primaryAligned, testAligned) {
  let marker = "";
  for (let index = 0; index < primaryAligned.length; index += 1) {
    const primaryChar = primaryAligned[index];
    const testChar = testAligned[index];
    if (primaryChar === "-" || testChar === "-") {
      marker += "-";
    } else if (primaryChar === testChar) {
      marker += "*";
    } else {
      marker += ".";
    }
  }
  return marker;
}

function buildComparisonsTextWithNotes(primaries, tests, notes) {
  const content = buildComparisonsText(primaries, tests);
  const cleanedNotes = notes ? notes.trimEnd() : "";
  return `${content}\n\nNotes:\n${cleanedNotes}`;
}

function triggerDownload(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadComparisons() {
  const primaries = getSelected("primary");
  const tests = getSelected("test");

  if (!primaries.length || !tests.length) {
    return;
  }

  const content = buildComparisonsText(primaries, tests);
  triggerDownload(content, "comparisons.txt");
}

function resetSelections() {
  state.selections.primary.clear();
  state.selections.test.clear();
  updateSelectionSummary();
}

function handleFileUpload(file) {
  if (!file) {
    return;
  }

  file
    .text()
    .then((text) => {
      state.proteins = parseFasta(text);
      updateFileMeta(file.name, state.proteins.length);
      resetSelections();
      resetHistory();
      renderProteinLists();
      showEmptyComparisons("Upload and select proteins, then compare.");
      elements.resultsMeta.textContent = "No comparisons yet.";
    })
    .catch(() => {
      state.proteins = [];
      updateFileMeta(null, 0);
      resetSelections();
      resetHistory();
      renderProteinLists();
      showEmptyComparisons("Could not read the file.");
      elements.resultsMeta.textContent = "No comparisons yet.";
    });
}

elements.fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  handleFileUpload(file);
});

elements.compareBtn.addEventListener("click", () => {
  renderComparisons();
  addHistoryEntry(getSelected("primary"), getSelected("test"));
});

elements.downloadBtn.addEventListener("click", () => {
  downloadComparisons();
});

updateSelectionSummary();
resetHistory();
