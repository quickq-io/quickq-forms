# quickq-forms

> FHIR-compatible form server for [`quickq`](https://github.com/quickq-io/quickq) questionnaires. Renders the form in a browser; writes responses straight back to `study.db`.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/downloads/)
[![Status: beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/quickq-io/quickq-forms/issues)

> **Status:** v0.1.x · beta. APIs may change before 1.0. Feedback welcome via [Issues](https://github.com/quickq-io/quickq-forms/issues).

quickq-forms is the reference delivery layer for quickq studies. quickq exports a FHIR `Questionnaire`; quickq-forms renders that JSON as an interactive React form, collects FHIR `QuestionnaireResponse` payloads from respondents, and persists them via a swappable adapter (local SQLite, file dump, or future hosted backend). The complete contract between the two repos is FHIR R4.

## When to use this vs. alternatives

quickq's FHIR contract works with any compliant delivery tool. Use quickq-forms when you want the path-of-least-resistance for a quickq study; use [LHC-Forms](https://lhncbc.nlm.nih.gov/LHC-forms/) (NLM) or [REDCap](https://projectredcap.org) if you already have institutional infrastructure around them. quickq-forms is purpose-built for the quickq round-trip — same authoring conventions, same skip-logic semantics, no impedance mismatch.

## Quickstart

The simplest path is via quickq's `serve` extra, which exposes `quickq serve study.db` as one command across the two repos:

```bash
# Clone both repos and install quickq with the serve extra
git clone https://github.com/quickq-io/quickq.git
git clone https://github.com/quickq-io/quickq-forms.git
uv tool install --reinstall ./quickq --with ./quickq-forms

# Run against your study (opens browser at localhost:8000)
quickq serve study.db
```

Or invoke quickq-forms directly:

```bash
cd quickq-forms
uv sync
uv pip install --editable ../quickq      # for local-adapter mode
uv run quickq-forms serve --db /path/to/study.db --port 8000
```

For the file-adapter mode (no quickq dependency, just a JSON file in / JSON files out):

```bash
uv run quickq-forms serve path/to/questionnaire.json --port 8000
```

For frontend dev mode with Vite HMR:

```bash
bash scripts/dev.sh --db /path/to/study.db
```

See [`docs/tutorials/end-to-end.md`](https://github.com/quickq-io/quickq/blob/main/docs/tutorials/end-to-end.md) (Step 6) in the quickq repo for the full beta-tester walkthrough.

## Architecture

```
React 19 + Vite (frontend/)
  ↓ POST /response
FastAPI server (quickq_forms/)
  ↓ ResponseAdapter
LocalAdapter   →  quickq SDK  →  study.db (SQLite)
FileAdapter    →  responses/<uuid>.QuestionnaireResponse.json
HostedAdapter  →  (future: queue / managed DB)
```

The server core has no adapter-specific logic — adding a new persistence backend is a single class implementing the `ResponseAdapter` interface. The frontend never imports from quickq; the FHIR boundary is the only contract.

## What's in this repo

- `quickq_forms/` — FastAPI server, adapters, serve module
- `frontend/` — React 19 + TypeScript + Vite, one component per question type
- `scripts/dev.sh` — concurrent uvicorn + Vite for frontend development
- `tests/` — server unit tests + e2e pipeline tests; `tests/e2e/` boots real subprocesses

## Related repos

- **[quickq](https://github.com/quickq-io/quickq)** — the SDK + CLI; `quickq serve` shims into this package
- **[quickq-docs](https://github.com/quickq-io/quickq-docs)** — published documentation site (in progress)

## License

Apache License 2.0 — see [LICENSE](LICENSE).
