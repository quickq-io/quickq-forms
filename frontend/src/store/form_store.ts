import { create } from 'zustand'
import { evaluateAll, findAnswersToDiscard } from '../engine/skip_logic'
import type { FormModel, FormState, AnswerValue } from '../types/form'

// Wire-format for a draft: Maps are not directly JSON-serializable, so we
// emit and accept the array-of-pairs form (`[...map.entries()]`). The
// `questionnaireUrl` is checked at hydration time as a sanity guard against
// loading a draft saved against a different questionnaire.
export interface DraftPayload {
  questionnaireUrl: string
  savedAt: string
  answers: Array<[string, AnswerValue[]]>
  groupInstances: Array<[string, number]>
}

interface FormStore extends FormState {
  model: FormModel | null

  setModel: (model: FormModel) => void
  setAnswer: (linkId: string, answers: AnswerValue[]) => void
  clearAnswer: (linkId: string) => void
  addInstance: (parentLinkId: string) => void
  removeInstance: (parentLinkId: string, index: number) => void
  hydrateFromDraft: (draft: DraftPayload) => void
  reset: () => void
}

function recompute(
  model: FormModel,
  answers: Map<string, AnswerValue[]>
): Pick<FormStore, 'answers' | 'enabled'> {
  let current = answers
  const dummyState: FormState = { answers: current, enabled: new Map(), groupInstances: new Map() }

  for (let pass = 0; pass < 2; pass++) {
    const enabled = evaluateAll(model.items, current)
    const toDiscard = findAnswersToDiscard({ ...dummyState, answers: current }, enabled)
    if (toDiscard.length === 0) return { answers: current, enabled }
    const next = new Map(current)
    for (const id of toDiscard) next.set(id, [])
    current = next
  }

  const enabled = evaluateAll(model.items, current)
  return { answers: current, enabled }
}

export const useFormStore = create<FormStore>((set, get) => ({
  model: null,
  answers: new Map(),
  enabled: new Map(),
  groupInstances: new Map(),

  setModel: (model) => {
    const enabled = evaluateAll(model.items, new Map())
    set({ model, answers: new Map(), enabled, groupInstances: new Map() })
  },

  setAnswer: (linkId, newAnswers) => {
    const { model, answers } = get()
    if (!model) return
    const next = new Map(answers)
    next.set(linkId, newAnswers)
    set(recompute(model, next))
  },

  clearAnswer: (linkId) => {
    const { model, answers } = get()
    if (!model) return
    const next = new Map(answers)
    next.set(linkId, [])
    set(recompute(model, next))
  },

  addInstance: (parentLinkId) => {
    const { groupInstances } = get()
    const next = new Map(groupInstances)
    next.set(parentLinkId, (next.get(parentLinkId) ?? 1) + 1)
    set({ groupInstances: next })
  },

  removeInstance: (parentLinkId, index) => {
    const { groupInstances, answers } = get()
    const count = groupInstances.get(parentLinkId) ?? 1
    if (count <= 1) return

    // Remove answers for the deleted instance, shift later instances down
    const item = get().model?.items.find(i => i.linkId === parentLinkId)
    const children = item?.children ?? []
    const nextAnswers = new Map(answers)
    const nextCount = count - 1

    for (let i = index; i < count; i++) {
      for (const child of children) {
        const currentKey = `${parentLinkId}[${i}]:${child.linkId}`
        const nextKey = `${parentLinkId}[${i - 1}]:${child.linkId}`
        if (i === index) {
          nextAnswers.delete(currentKey)
        } else {
          const shifted = nextAnswers.get(currentKey) ?? []
          nextAnswers.set(nextKey, shifted)
          nextAnswers.delete(currentKey)
        }
      }
    }

    const nextInstances = new Map(groupInstances)
    nextInstances.set(parentLinkId, nextCount)
    set({ answers: nextAnswers, groupInstances: nextInstances })
  },

  hydrateFromDraft: (draft) => {
    const { model } = get()
    if (!model) return
    // If the draft was saved against a different questionnaire (e.g. the
    // researcher edited the YAML after the respondent started filling),
    // ignore the draft rather than risk loading state for linkIds that no
    // longer exist.
    if (draft.questionnaireUrl && draft.questionnaireUrl !== model.questionnaireUrl) {
      return
    }
    const answers = new Map(draft.answers)
    const groupInstances = new Map(draft.groupInstances)
    set(recompute(model, answers))
    set({ groupInstances })
  },

  reset: () => {
    const { model } = get()
    if (!model) return
    const enabled = evaluateAll(model.items, new Map())
    set({ answers: new Map(), enabled, groupInstances: new Map() })
  },
}))

export function buildDraftPayload(state: {
  model: FormModel
  answers: Map<string, AnswerValue[]>
  groupInstances: Map<string, number>
}): DraftPayload {
  return {
    questionnaireUrl: state.model.questionnaireUrl,
    savedAt: new Date().toISOString(),
    answers: [...state.answers.entries()],
    groupInstances: [...state.groupInstances.entries()],
  }
}

// Utility: build the answer key for a child inside a repeating group
export function groupChildKey(parentLinkId: string, instanceIndex: number, childLinkId: string): string {
  return `${parentLinkId}[${instanceIndex}]:${childLinkId}`
}
