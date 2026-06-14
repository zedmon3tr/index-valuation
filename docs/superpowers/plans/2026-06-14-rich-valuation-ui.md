# Rich Valuation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable historical dividend-yield data and rebuild the detail screen into a richer, reference-driven valuation analysis workspace.

**Architecture:** Keep the static deployment model. Extend CI-generated JSON with a `dy` series, move deterministic analysis helpers into a browser/Node-compatible module, and let `app.js` compose controls, statistics, tables, and ECharts layers from available series.

**Tech Stack:** Vanilla JavaScript, CSS, ECharts 5, Python 3, Node.js built-in test runner, Python unittest.

---

### Task 1: Extract Testable Analysis Helpers

**Files:**
- Create: `valuation-core.js`
- Create: `tests/valuation-core.test.js`
- Modify: `index.html`

- [ ] Write failing Node tests for statistics, range slicing, custom dates, moving averages, period sampling, and date alignment.
- [ ] Run `node --test tests/valuation-core.test.js` and confirm failures caused by missing exports.
- [ ] Implement the minimal UMD-compatible helper module.
- [ ] Run the Node tests and confirm they pass.

### Task 2: Add Dividend-Series Data Assembly

**Files:**
- Create: `scripts/data_utils.py`
- Create: `tests/test_data_utils.py`
- Modify: `scripts/build_data.py`

- [ ] Write failing unittest cases for merging independently dated PE, PB, and dividend-yield series.
- [ ] Run `python3 -m unittest tests/test_data_utils.py -v` and confirm the missing module failure.
- [ ] Implement date-series merging.
- [ ] Extend the build script with CSI official dividend yield and HSI dividend yield fetchers.
- [ ] Emit aligned `dates`, `pe`, `pb`, and `dy` arrays while preserving graceful failure.
- [ ] Run the Python tests and syntax compilation.

### Task 3: Build the Rich Detail Workspace

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `index.html`

- [ ] Add dynamic dividend-yield metric tabs.
- [ ] Add range, custom-date, period, moving-average, line-toggle, and view controls.
- [ ] Render the expanded statistics list and explicit data coverage.
- [ ] Render dual-axis valuation/index charts and optional moving-average, percentile, and standard-deviation lines.
- [ ] Render a sortable-looking read-only detail table for the current filtered series.
- [ ] Add desktop-density and narrow-screen responsive styles.

### Task 4: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] Document dividend-yield coverage and the `dy` JSON field.
- [ ] Run `node --test tests/valuation-core.test.js`.
- [ ] Run `python3 -m unittest tests/test_data_utils.py -v`.
- [ ] Run `node --check app.js` and Python compile checks.
- [ ] Reload the local page and verify the detail screen in the in-app browser at desktop and mobile widths.
- [ ] Inspect `git diff --check` and the final diff for unrelated changes.
