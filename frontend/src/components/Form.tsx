import { useEffect, useMemo, useRef, useState } from 'react'
import { buildDraftPayload, useFormStore } from '../store/form_store'
import type { DraftPayload } from '../store/form_store'
import { parseQuestionnaire } from '../engine/fhir_parser'
import { serializeResponse } from '../engine/fhir_serializer'
import { Question } from './Question'
import { FormUiProvider } from './form_context'
import { buildNumbering } from './numbering'
import type { Questionnaire } from '../types/fhir'
import type { FormItem, FormModel } from '../types/form'

const DRAFT_DEBOUNCE_MS = 1000

// Pulls the respondent ID from the URL query string. Convention: `?r=R042`.
// Returns null when absent. Kept as a function (not a constant) because in
// tests the URL may change between mounts.
function readRespondentId(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const value = params.get('r')
  return value && value.trim() ? value.trim() : null
}

export function Form() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [preview, setPreview] = useState(false)
  const [invalidLinkIds, setInvalidLinkIds] = useState<Set<string>>(new Set())
  const [respondentId] = useState<string | null>(() => readRespondentId())
  const [draftsEnabled, setDraftsEnabled] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [draftResumed, setDraftResumed] = useState(false)
  const [rosterRejection, setRosterRejection] = useState<'missing' | 'invalid' | null>(null)
  const hydrateFromDraft = useFormStore(s => s.hydrateFromDraft)

  const model = useFormStore(s => s.model)
  const setModel = useFormStore(s => s.setModel)
  const answers = useFormStore(s => s.answers)
  const enabled = useFormStore(s => s.enabled)
  const groupInstances = useFormStore(s => s.groupInstances)

  const numbering = useMemo(() => (model ? buildNumbering(model) : new Map<string, number>()), [model])

  // Required-field progress: count enabled required questions and how many have answers.
  const { requiredTotal, requiredAnswered } = useMemo(
    () => model ? countRequiredProgress(model, answers, enabled) : { requiredTotal: 0, requiredAnswered: 0 },
    [model, answers, enabled],
  )

  useEffect(() => {
    const configUrl = respondentId
      ? `/config?r=${encodeURIComponent(respondentId)}`
      : '/config'
    Promise.all([
      fetch('/questionnaire').then(r => {
        if (!r.ok) throw new Error(`Questionnaire load failed: ${r.status}`)
        return r.json() as Promise<Questionnaire>
      }),
      // /config is optional — older servers won't have it; default to live mode
      fetch(configUrl).then(r => (r.ok ? r.json() : { preview: false })).catch(() => ({ preview: false })),
    ])
      .then(([q, cfg]) => {
        setModel(parseQuestionnaire(q))
        setPreview(Boolean(cfg.preview))
        setDraftsEnabled(Boolean(cfg.drafts_enabled))
        if (cfg.roster_enforced) {
          if (!respondentId) {
            setRosterRejection('missing')
          } else if (cfg.respondent_valid === false) {
            setRosterRejection('invalid')
          }
        }
        setLoading(false)
      })
      .catch(e => {
        setError(String(e))
        setLoading(false)
      })
  }, [setModel, respondentId])

  // Hydrate from a saved draft once the model is ready and we know drafts are
  // supported by this server. Runs at most once per page load; failure to
  // load (404, parse error, etc.) is silently treated as "no draft." Waits
  // until the model is loaded — without that guard, the effect would mark
  // itself hydrated on the very first render (model still null) and the
  // server-side fetch would never run.
  useEffect(() => {
    if (draftHydrated) return
    if (!model) return
    if (!draftsEnabled || !respondentId) {
      setDraftHydrated(true)
      return
    }
    fetch(`/draft?r=${encodeURIComponent(respondentId)}`)
      .then(r => (r.ok ? (r.json() as Promise<DraftPayload>) : null))
      .then(draft => {
        if (draft) {
          hydrateFromDraft(draft)
          setDraftResumed(true)
        }
        setDraftHydrated(true)
      })
      .catch(() => setDraftHydrated(true))
  }, [model, draftsEnabled, respondentId, draftHydrated, hydrateFromDraft])

  // Autosave: debounced POST /draft on every change to answers or
  // groupInstances. A latest-state ref avoids stale closures inside the
  // setTimeout callback — when the timer fires, we serialize whatever state
  // is currently in the store, not whatever was in scope at scheduling time.
  const draftSaveTimer = useRef<number | null>(null)
  const latestState = useRef({ model, answers, groupInstances })
  useEffect(() => {
    latestState.current = { model, answers, groupInstances }
  }, [model, answers, groupInstances])

  useEffect(() => {
    if (!draftHydrated) return
    if (!model || !draftsEnabled || !respondentId) return
    // Skip the initial post-hydration tick where state is genuinely empty —
    // it would otherwise overwrite a draft that the server just told us
    // doesn't exist with another empty record, and (worse) race with the
    // FIRST real user click in tests with a quick debounce.
    if (answers.size === 0 && groupInstances.size === 0) return
    if (draftSaveTimer.current !== null) {
      window.clearTimeout(draftSaveTimer.current)
    }
    draftSaveTimer.current = window.setTimeout(() => {
      const s = latestState.current
      if (!s.model) return
      const payload = buildDraftPayload({
        model: s.model,
        answers: s.answers,
        groupInstances: s.groupInstances,
      })
      fetch(`/draft?r=${encodeURIComponent(respondentId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    }, DRAFT_DEBOUNCE_MS)
    return () => {
      if (draftSaveTimer.current !== null) {
        window.clearTimeout(draftSaveTimer.current)
      }
    }
  }, [answers, groupInstances, draftHydrated, model, draftsEnabled, respondentId])

  // Clear the validation highlight for a question as soon as it gets answered.
  // No-op until the user has clicked Submit at least once and triggered population.
  useEffect(() => {
    if (invalidLinkIds.size === 0) return
    const stillMissing = new Set<string>()
    for (const id of invalidLinkIds) {
      const isEnabled = enabled.get(id) ?? true
      const hasAnswer = (answers.get(id) ?? []).length > 0
      if (isEnabled && !hasAnswer) stillMissing.add(id)
    }
    if (stillMissing.size !== invalidLinkIds.size) {
      setInvalidLinkIds(stillMissing)
    }
  }, [answers, enabled, invalidLinkIds])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!model) return

    const missing = collectMissingRequired(model, answers, enabled)
    if (missing.length > 0) {
      setInvalidLinkIds(new Set(missing))
      // Scroll to the first missing item so the user knows where to look.
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-link-id="${cssEscape(missing[0])}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }
    setInvalidLinkIds(new Set())

    const response = serializeResponse(
      model,
      { answers, enabled, groupInstances },
      { respondentId },
    )
    const res = await fetch('/response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    })
    if (res.ok) {
      setSubmitted(true)
    } else {
      setError(`Submission failed: ${res.status}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500 text-sm">Loading questionnaire…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  if (rosterRejection) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
        <div
          data-testid="roster-rejection"
          className="max-w-md w-full rounded-2xl bg-white border border-gray-200 shadow-sm px-8 py-10 text-center"
        >
          <h1 className="text-xl font-semibold text-gray-900">
            {rosterRejection === 'missing'
              ? 'This link is missing a respondent code.'
              : 'This link is not valid for this study.'}
          </h1>
          <p className="mt-3 text-sm text-gray-600">
            Please contact the researcher who sent you this link.
          </p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
        <div className="max-w-md w-full rounded-2xl bg-white border border-gray-200 shadow-sm px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg
              className="h-6 w-6 text-green-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Thank you</h1>
          <p className="mt-2 text-sm text-gray-600">Your response has been submitted.</p>
        </div>
      </div>
    )
  }

  if (!model) return null

  const progressPct = requiredTotal > 0 ? Math.round((requiredAnswered / requiredTotal) * 100) : 0

  return (
    <FormUiProvider value={{ numbering, invalidLinkIds }}>
      <div className="min-h-screen bg-gray-50">
        {preview && (
          <div
            data-testid="preview-banner"
            className="sticky top-0 z-20 bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-sm text-amber-900"
          >
            <strong>Preview mode</strong> — responses are not saved. Inputs are read-only.
          </div>
        )}

        {requiredTotal > 0 && !preview && (
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200">
            <div className="mx-auto max-w-2xl px-4 py-2">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>{requiredAnswered} of {requiredTotal} required answered</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                <div
                  data-testid="progress-fill"
                  className="h-full bg-blue-600 transition-all duration-200"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="mx-auto max-w-2xl px-4 py-10">
          <header className="mb-8">
            <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">{model.title}</h1>
            {model.description && (
              <p className="mt-3 text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                {model.description}
              </p>
            )}
            {respondentId && (
              <p
                data-testid="respondent-id"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
              >
                Respondent: <span className="font-mono text-gray-900">{respondentId}</span>
              </p>
            )}
          </header>

          {draftResumed && (
            <div
              data-testid="draft-resumed"
              className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
            >
              Welcome back — your previous answers were restored.
            </div>
          )}

          {invalidLinkIds.size > 0 && (
            <div
              data-testid="validation-banner"
              role="alert"
              className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <strong>{invalidLinkIds.size}</strong>{' '}
              required {invalidLinkIds.size === 1 ? 'question needs' : 'questions need'} an answer
              before you can submit.
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
            <fieldset disabled={preview} className="flex flex-col gap-8 border-0 p-0 m-0 min-w-0">
              {model.items.map(item => (
                <Question key={item.linkId} item={item} />
              ))}
            </fieldset>

            {!preview && (
              <div className="pt-4 border-t border-gray-200">
                <button
                  type="submit"
                  className="w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                >
                  Submit
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </FormUiProvider>
  )
}

// CSS.escape isn't on the global type yet for older lib targets; this is a
// minimal escape for the characters our linkIds actually contain (`.`, `[`, `]`, `:`).
function cssEscape(s: string): string {
  return s.replace(/(["\\.\[\]:])/g, '\\$1')
}

// Walks the model, returns linkIds of every required+enabled question that has
// no answer in `answers`. Children of a repeating-group instance aren't checked
// here because the per-instance keying is not yet wired into required-field
// tracking — the parent's required flag covers "did the respondent fill out at
// least one instance," which is the common case.
function collectMissingRequired(
  model: FormModel,
  answers: Map<string, unknown[]>,
  enabled: Map<string, boolean>,
): string[] {
  const missing: string[] = []
  function walk(items: FormItem[]) {
    for (const item of items) {
      if (item.type === 'section') {
        walk(item.children ?? [])
        continue
      }
      if (item.type === 'instruction') continue
      if (!(enabled.get(item.linkId) ?? true)) continue
      if (!item.required) continue
      if (item.type === 'repeating_group' || item.type === 'grid') continue
      const has = (answers.get(item.linkId) ?? []).length > 0
      if (!has) missing.push(item.linkId)
    }
  }
  walk(model.items)
  return missing
}

function countRequiredProgress(
  model: FormModel,
  answers: Map<string, unknown[]>,
  enabled: Map<string, boolean>,
): { requiredTotal: number; requiredAnswered: number } {
  let total = 0
  let answered = 0
  function walk(items: FormItem[]) {
    for (const item of items) {
      if (item.type === 'section') {
        walk(item.children ?? [])
        continue
      }
      if (item.type === 'instruction') continue
      if (!(enabled.get(item.linkId) ?? true)) continue
      if (!item.required) continue
      if (item.type === 'repeating_group' || item.type === 'grid') continue
      total += 1
      if ((answers.get(item.linkId) ?? []).length > 0) answered += 1
    }
  }
  walk(model.items)
  return { requiredTotal: total, requiredAnswered: answered }
}
