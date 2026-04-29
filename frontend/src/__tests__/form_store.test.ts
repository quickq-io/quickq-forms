import { describe, it, expect, beforeEach } from 'vitest'
import { useFormStore } from '../store/form_store'
import { parseQuestionnaire } from '../engine/fhir_parser'
import type { Questionnaire } from '../types/fhir'
import type { AnswerValue } from '../types/form'

import phq9Fixture from './fixtures/phq9_fhir_questionnaire.json'

const coding = (code: string, system?: string): AnswerValue => ({ type: 'coding', coding: { code, system } })
const loinc = 'http://loinc.org'

beforeEach(() => {
  // Reset store state between tests
  useFormStore.setState({
    model: null,
    answers: new Map(),
    enabled: new Map(),
  })
})

describe('useFormStore', () => {
  it('initialises with empty answers after setModel', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    useFormStore.getState().setModel(model)
    expect(useFormStore.getState().answers.size).toBe(0)
  })

  it('all items start enabled when no skip logic conditions are met', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    useFormStore.getState().setModel(model)
    // phq9.difficulty has enableWhen — starts disabled with no answers
    expect(useFormStore.getState().enabled.get('phq9.difficulty')).toBe(false)
    // phq9.1 has no enableWhen — always enabled
    expect(useFormStore.getState().enabled.get('phq9.1')).toBe(true)
  })

  it('setAnswer stores the answer', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    useFormStore.getState().setModel(model)
    useFormStore.getState().setAnswer('phq9.1', [coding('LA6569-3', loinc)])
    expect(useFormStore.getState().answers.get('phq9.1')).toEqual([
      { type: 'coding', coding: { code: 'LA6569-3', system: loinc } },
    ])
  })

  it('enables phq9.difficulty when any PHQ item is non-zero', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    useFormStore.getState().setModel(model)
    // phq9.1 = "Not at all" → difficulty still disabled
    useFormStore.getState().setAnswer('phq9.1', [coding('LA6568-5', loinc)])
    expect(useFormStore.getState().enabled.get('phq9.difficulty')).toBe(false)
    // phq9.2 = "Several days" → difficulty enabled
    useFormStore.getState().setAnswer('phq9.2', [coding('LA6569-3', loinc)])
    expect(useFormStore.getState().enabled.get('phq9.difficulty')).toBe(true)
  })

  it('clears answers for items that become disabled', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    useFormStore.getState().setModel(model)
    // Answer phq9.2 so difficulty becomes enabled, then answer difficulty
    useFormStore.getState().setAnswer('phq9.2', [coding('LA6569-3', loinc)])
    useFormStore.getState().setAnswer('phq9.difficulty', [coding('1')])
    expect(useFormStore.getState().answers.get('phq9.difficulty')).toHaveLength(1)
    // Now change phq9.2 back to "Not at all" — if all others are zero, difficulty is disabled
    useFormStore.getState().setAnswer('phq9.2', [coding('LA6568-5', loinc)])
    // difficulty should be cleared since it's now disabled
    const difficultyAnswers = useFormStore.getState().answers.get('phq9.difficulty') ?? []
    expect(difficultyAnswers).toHaveLength(0)
  })

  it('clearAnswer removes the answer', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    useFormStore.getState().setModel(model)
    useFormStore.getState().setAnswer('phq9.1', [coding('LA6568-5', loinc)])
    useFormStore.getState().clearAnswer('phq9.1')
    expect(useFormStore.getState().answers.get('phq9.1')).toHaveLength(0)
  })

  it('reset clears all answers', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    useFormStore.getState().setModel(model)
    useFormStore.getState().setAnswer('phq9.1', [coding('LA6568-5', loinc)])
    useFormStore.getState().setAnswer('phq9.2', [coding('LA6569-3', loinc)])
    useFormStore.getState().reset()
    expect(useFormStore.getState().answers.size).toBe(0)
  })
})
