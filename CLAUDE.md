# CLAUDE.md — quickq-forms

## Project Purpose

`quickq-forms` is the respondent-facing survey delivery layer for the quickq ecosystem. It renders a FHIR `Questionnaire` as an interactive web form, collects responses, and returns a FHIR `QuestionnaireResponse`.

It is a separate repository from `quickq`. The two communicate exclusively through FHIR JSON. `quickq-forms` has no knowledge of quickq's internal schema — the FHIR contract is the only interface and must remain so.

The primary entry point for researchers is `quickq serve study.db`, a command in the `quickq` CLI that delegates to this package.

---

## Relationship to quickq

```
quickq (SDK + CLI)
  ↓  quickq export-fhir → Questionnaire.json
  ↓  quickq serve study.db (delegates to quickq-forms)
  [browser — respondent fills out form]
  ↓  QuestionnaireResponse.json POSTed to FastAPI server
  ↓  adapter persists response
  ↑  quickq import-fhir-response (local adapter writes directly to study.db)
quickq (SDK + CLI)
```

**The contract:** a valid FHIR R4 `Questionnaire` goes in; a valid FHIR R4 `QuestionnaireResponse` comes out. Nothing else crosses the boundary between the two repos.

---

## Architecture

```
quickq-forms/
  CLAUDE.md
  pyproject.toml                  # Python package: quickq-forms CLI + server

  server/                         # FastAPI application
    main.py                       # app, routes, startup
    adapters/
      base.py                     # ResponseAdapter abstract base class
      local.py                    # writes to study.db via quickq SDK
      file.py                     # writes QuestionnaireResponse.json to disk
      hosted.py                   # future: remote DB / queue
    models.py                     # Pydantic models — request/response validation
    config.py                     # settings (adapter type, db path, port, etc.)

  frontend/                       # React 19 + TypeScript + Vite
    package.json
    vite.config.ts
    tsconfig.json
    src/
      components/
        questions/                # one component per question type
          SingleChoice.tsx
          MultipleChoice.tsx
          SataOther.tsx
          Boolean.tsx
          Text.tsx
          Numeric.tsx
          DateQuestion.tsx
          Likert.tsx
          Grid.tsx
          Slider.tsx
          Ranked.tsx              # uses dnd-kit
          RepeatingGroup.tsx
        Form.tsx                  # orchestrator: progress, navigation, submit
        Question.tsx              # dispatcher: routes FHIR item to component
      engine/
        skip_logic.ts             # pure TS: evaluates enableWhen against FormState
        fhir_parser.ts            # Questionnaire → FormModel
        fhir_serializer.ts        # FormState → QuestionnaireResponse
      store/
        form_store.ts             # Zustand store: answers, enabled state, progress
      types/
        fhir.ts                   # FHIR R4 type definitions
        form.ts                   # internal FormModel and FormState types

  tests/
    test_server.py                # FastAPI route tests
    test_adapters.py              # adapter correctness
    test_models.py                # Pydantic model validation
    e2e/                          # Playwright: render → fill → assert response

  scripts/
    dev.sh                        # starts uvicorn + vite dev server concurrently
```

---

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Server | FastAPI (Python) | Consistent with quickq; native async; clean OpenAPI docs |
| Validation | Pydantic v2 | Validates incoming QuestionnaireResponse at the server boundary; enforces FHIR structure before hitting the adapter |
| Frontend framework | React 19 + TypeScript | Component-per-question-type pattern; largest ecosystem; best AI tooling coverage |
| Build | Vite | Fast HMR, first-class TypeScript, static build for production |
| State | Zustand | Lightweight, TypeScript-first; skip logic engine needs access to all answers across the component tree without prop drilling |
| Drag-to-rank | none (add dnd-kit if needed) | Ranked questions are uncommon in health/epi surveys; implement as numbered dropdowns unless a drag interface is explicitly required |
| Styling | Tailwind CSS | Utility-first, no runtime CSS, appropriate for purpose-built form components |
| Python tests | pytest | Standard |
| Frontend unit tests | Vitest + React Testing Library | Co-located with Vite, fast, idiomatic |
| E2E tests | Playwright | Same tooling as quickq E2E suite |

No UI component library. Every question type is a purpose-built component. Generic component libraries add friction for survey form UX requirements — the design constraints are specific enough to warrant custom components throughout.

---

## FastAPI Server

### Routes

```python
GET  /questionnaire          # returns the loaded Questionnaire JSON
POST /response               # accepts a QuestionnaireResponse, persists via adapter
GET  /health                 # liveness check
```

### Pydantic Models (`server/models.py`)

Pydantic validates the structure of incoming `QuestionnaireResponse` before any adapter or SDK code runs. Invalid responses are rejected at the boundary with a clear 422 error — they never reach the database.

```python
from pydantic import BaseModel, Field
from typing import Literal, Any

class AnswerValue(BaseModel):
    valueString: str | None = None
    valueDecimal: float | None = None
    valueInteger: int | None = None
    valueBoolean: bool | None = None
    valueDate: str | None = None
    valueDateTime: str | None = None
    valueCoding: dict[str, str] | None = None

class ResponseItem(BaseModel):
    linkId: str
    text: str | None = None
    answer: list[AnswerValue] = Field(default_factory=list)
    item: list['ResponseItem'] = Field(default_factory=list)

class QuestionnaireResponsePayload(BaseModel):
    resourceType: Literal["QuestionnaireResponse"]
    questionnaire: str                    # canonical URL — must match loaded questionnaire
    status: Literal["completed", "in-progress", "amended", "stopped"]
    authored: str | None = None           # ISO 8601
    item: list[ResponseItem] = Field(default_factory=list)
```

Pydantic v2 is required. Use `model_validator` for cross-field rules (e.g. `questionnaire` URL must match the currently loaded instrument).

### Settings (`server/config.py`)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    adapter: Literal["local", "file", "hosted"] = "local"
    db_path: str | None = None            # required for local adapter
    output_dir: str | None = None         # required for file adapter
    questionnaire_id: int = 1
    port: int = 5173
    host: str = "127.0.0.1"
    open_browser: bool = True

    model_config = {"env_prefix": "QUICKQ_FORMS_"}
```

---

## The Adapter Pattern

```python
# server/adapters/base.py
from abc import ABC, abstractmethod
from server.models import QuestionnaireResponsePayload

class ResponseAdapter(ABC):
    @abstractmethod
    def save(self, response: QuestionnaireResponsePayload) -> str:
        """Persist a validated QuestionnaireResponse. Returns a session identifier."""

    @abstractmethod
    def load_questionnaire(self) -> dict:
        """Return the FHIR Questionnaire dict to serve to the frontend."""
```

**Local adapter** (`local.py`): calls `quickq.authoring.import_fhir_response()` and `quickq.schema.open_oltp()`. Requires `quickq` installed. Used exclusively by `quickq serve`.

**File adapter** (`file.py`): writes `{uuid}.QuestionnaireResponse.json` to a configured output directory. No quickq dependency — works standalone.

**Hosted adapter** (`hosted.py`, future): POSTs to a remote endpoint or writes to a managed database. Authentication and multi-tenancy live here, not in the server core.

The adapter is injected at startup. The server core has no `if adapter == "local"` branches.

---

## Question Types

All 13 question types are required in v1. No deferrals.

| Type | FHIR `item.type` | Component | Notes |
|---|---|---|---|
| `single_choice` | `choice` | `SingleChoice.tsx` | Radio group |
| `multiple_choice` | `choice` (repeats) | `MultipleChoice.tsx` | Checkbox group |
| `sata_other` | `open-choice` | `SataOther.tsx` | Checkboxes + free-text Other |
| `boolean` | `boolean` | `Boolean.tsx` | Yes/No |
| `text` | `text` | `Text.tsx` | Textarea |
| `numeric` | `decimal` / `integer` | `Numeric.tsx` | Number input, optional min/max/step |
| `date` | `date` | `DateQuestion.tsx` | Date picker |
| `datetime` | `dateTime` | `DateQuestion.tsx` | Date + time picker |
| `likert` | `choice` (ordered) | `Likert.tsx` | Horizontal scale, labeled endpoints |
| `grid` | `group` | `Grid.tsx` | Matrix: rows × columns, each cell a choice |
| `slider` | `decimal` + extensions | `Slider.tsx` | Range input with min/max/step labels |
| `ranked` | `choice` + extensions | `Ranked.tsx` | Numbered dropdowns (one per item); add drag interface later if needed |
| `repeating_group` | `group` (repeats) | `RepeatingGroup.tsx` | Add/remove instances; each instance renders sub-questions |

Implement in complexity order: single_choice → boolean → text → numeric → date → multiple_choice → sata_other → likert → slider → grid → repeating_group → ranked.

---

## Zustand Form Store

The Zustand store is the single source of truth for form state. The skip logic engine reads from it; question components write to it.

```typescript
// store/form_store.ts
import { create } from 'zustand'

interface FormStore {
  answers: Map<string, AnswerValue[]>      // linkId → answers
  enabled: Map<string, boolean>            // linkId → is currently enabled
  questionnaire: Questionnaire | null

  setAnswer: (linkId: string, answers: AnswerValue[]) => void
  clearAnswer: (linkId: string) => void
  setEnabled: (linkId: string, enabled: boolean) => void
  setQuestionnaire: (q: Questionnaire) => void
}
```

Skip logic evaluation runs in a `useEffect` that subscribes to `answers` changes, re-evaluates all `enableWhen` rules, updates `enabled`, and clears answers for newly-disabled items.

---

## Skip Logic Engine

Pure TypeScript, no React dependency, fully unit-testable.

```typescript
// engine/skip_logic.ts

export function evaluateEnableWhen(
  item: QuestionnaireItem,
  answers: Map<string, AnswerValue[]>
): boolean

export function evaluateAll(
  items: QuestionnaireItem[],
  answers: Map<string, AnswerValue[]>
): Map<string, boolean>  // linkId → enabled
```

**Rules:**
- No `enableWhen` → always enabled
- `enableBehavior: "all"` → AND across all rules (default)
- `enableBehavior: "any"` → OR across all rules
- A newly-disabled item's answer must be cleared from the store
- Operators: `exists`, `=`, `!=`, `>`, `<`, `>=`, `<=`

The engine must be tested exhaustively — all operators, all `enableBehavior` combinations, cascading dependencies (question A controls B, B controls C).

---

## FHIR Parser and Serializer

### Parser (`engine/fhir_parser.ts`)

Converts a FHIR `Questionnaire` to an internal `FormModel` optimised for rendering.

- Flattens nested `item` arrays into a traversable structure
- Detects grid questions: a `group` whose children are all `choice` type
- Reads slider extensions (min, max, step, labels)
- Reads ranked ordering extensions
- Reads repeating group count linkage (`questionnaire-maxOccurs`)

### Serializer (`engine/fhir_serializer.ts`)

Converts `FormState` to a valid FHIR `QuestionnaireResponse`.

- Excludes answers for disabled items (skip logic enforcement)
- Correct `answer[x]` type per question type (`valueString`, `valueDecimal`, `valueCoding`, `valueBoolean`, `valueDate`, `valueDateTime`)
- Repeating group instances serialized as repeated `item` entries with the same `linkId`
- Sets `status: "completed"` when all required enabled items have answers

---

## Local Deployment (`quickq serve`)

```bash
quickq serve study.db [--questionnaire-id 1] [--port 5173] [--no-browser]
```

The `quickq serve` command lives in the `quickq` CLI (`quickq/cli.py`). It imports from `quickq_forms.server` and raises a clear `ClickException` if `quickq-forms` is not installed.

Behavior:
1. Exports the FHIR Questionnaire from `study.db` for the given questionnaire ID
2. Starts FastAPI with the local adapter pointed at `study.db`
3. Serves the pre-built React frontend as static files
4. Opens `http://localhost:{port}` in the browser
5. Submitted responses are written directly to `study.db` via `import_fhir_response`

In development, Vite's dev server proxies `/questionnaire` and `/response` to uvicorn. In production, FastAPI serves the static build from `frontend/dist/`. No Node.js required at runtime.

---

## Hosted Deployment

The hosted adapter is the only thing that changes. The server core and frontend are identical.

A hosted deployment adds:
- Session tokens (concurrent respondents must not collide)
- Authentication (only authorized respondents access the form)
- Persistent response storage

These concerns belong exclusively in the hosted adapter or a reverse proxy. **The server core must never assume or require auth, sessions, or multi-tenancy.** Adding those concerns to `main.py` or `models.py` would break the local deployment model.

---

## Test Strategy

**pytest (server):**
- Route tests: `GET /questionnaire` returns valid FHIR JSON; `POST /response` with valid payload returns 200
- Pydantic validation: invalid `resourceType`, missing `linkId`, wrong `answer[x]` type all return 422
- Adapter tests: local adapter writes a parseable response to SQLite; file adapter writes valid JSON

**Vitest + React Testing Library (frontend):**
- Skip logic engine: all operators, AND/OR, cascading dependencies, disabled item answer clearing
- FHIR parser: all question types, nested groups, grid detection, extensions
- FHIR serializer: correct `answer[x]` types, disabled items excluded, repeating group structure
- Each question component: renders correctly, fires correct state updates on interaction

**Playwright (E2E):**
- Render each question type; verify it appears and is interactive
- Answer a trigger question; verify dependent questions appear/disappear
- Submit a complete form; assert `QuestionnaireResponse` structure matches expected
- Repeating group: add two instances, fill both, assert both appear in response
- Ranked question: drag to reorder, assert order is reflected in response

E2E suite runs against the real FastAPI server with the file adapter — no SQLite dependency in CI.

---

## Design Constraints

**Lightweight, elegant, and maintainable.** Prefer fewer dependencies over more. Every library added is a maintenance surface — a future version conflict, a security patch, a breaking API change. Before adding a dependency, ask whether the problem can be solved with standard browser APIs, React primitives, or a small amount of well-understood code. The stack should be readable and extensible by a developer who wasn't in the original design sessions.

**The FHIR contract is the only interface.** The frontend never imports from `quickq`. The file and hosted adapters must work without `quickq` installed.

**All 13 question types from v1.** A form that silently skips an unsupported question type is worse than one that refuses to load. If a type cannot be rendered, raise a clear error.

**Disabled items must be excluded from responses.** The serializer enforces this — answers to skipped questions must never appear in the `QuestionnaireResponse`, regardless of what the store contains.

**Local mode works offline.** No CDN dependencies in production builds. The frontend is a self-contained static bundle.

**Pydantic validates at the boundary.** No raw dict access inside adapters. Every `QuestionnaireResponse` that enters the system has been validated by Pydantic before adapter code runs.

**The server core has no adapter-specific logic.** No `if adapter == "local"` in `main.py`. Adapter behavior is entirely encapsulated behind the `ResponseAdapter` interface.

---

## Commands

```bash
# Python setup
uv sync

# Frontend setup
npm install --prefix frontend

# Development (both servers)
bash scripts/dev.sh
# or separately:
uv run uvicorn server.main:app --reload --port 8000
npm run dev --prefix frontend          # Vite on :5173, proxies /api to :8000

# Testing
uv run pytest                          # server unit + integration tests
npm run test --prefix frontend         # Vitest unit tests
uv run pytest tests/e2e/               # Playwright E2E (requires running server)

# Production build
npm run build --prefix frontend        # outputs to frontend/dist/
uv run quickq-forms serve study.db     # FastAPI serves static build
```

---

## Standards References

- [HL7 FHIR Questionnaire R4](https://hl7.org/fhir/R4/questionnaire.html)
- [HL7 FHIR QuestionnaireResponse R4](https://hl7.org/fhir/R4/questionnaireresponse.html)
- [FHIR SDC Implementation Guide](https://hl7.org/fhir/uv/sdc/) — skip logic, repeating groups, extensions
- [Zustand](https://zustand-demo.pmnd.rs) — form state management
- [Pydantic v2](https://docs.pydantic.dev/latest/) — server-side validation
- [quickq CLAUDE.md](../quickq/CLAUDE.md) — upstream SDK, FHIR export spec, question type definitions
