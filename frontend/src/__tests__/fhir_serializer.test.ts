import { describe, it, expect } from 'vitest'
import { serializeResponse } from '../engine/fhir_serializer'
import { parseQuestionnaire } from '../engine/fhir_parser'
import { evaluateAll } from '../engine/skip_logic'
import type { Questionnaire } from '../types/fhir'
import type { FormModel, FormState, AnswerValue } from '../types/form'

import phq9Fixture from './fixtures/phq9_fhir_questionnaire.json'
import goutFixture from './fixtures/gout_checkin_fhir_questionnaire.json'

const coding = (code: string, system?: string): AnswerValue => ({ type: 'coding', coding: { code, system } })
const str = (value: string): AnswerValue => ({ type: 'string', value })
const bool = (value: boolean): AnswerValue => ({ type: 'boolean', value })
const decimal = (value: number): AnswerValue => ({ type: 'decimal', value })
const dateVal = (value: string): AnswerValue => ({ type: 'date', value })

function makeState(
  model: FormModel,
  answers: Record<string, AnswerValue[]>
): FormState {
  const answerMap = new Map<string, AnswerValue[]>(Object.entries(answers))
  const enabled = evaluateAll(model.items, answerMap)
  return { answers: answerMap, enabled, groupInstances: new Map() }
}

describe('serializeResponse — basic', () => {
  it('produces correct resourceType and questionnaire url', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    const state = makeState(model, {})
    const response = serializeResponse(model, state)
    expect(response.resourceType).toBe('QuestionnaireResponse')
    expect(response.questionnaire).toBe('http://quickq.io/instruments/phq9')
  })

  it('status is in-progress when required items unanswered', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    const state = makeState(model, {})
    expect(serializeResponse(model, state).status).toBe('in-progress')
  })

  it('status is completed when all required items answered', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    const loinc = 'http://loinc.org'
    // PHQ-9 items 1-9 are required; difficulty is not required
    const answers: Record<string, AnswerValue[]> = {}
    for (let i = 1; i <= 9; i++) {
      answers[`phq9.${i}`] = [coding('LA6568-5', loinc)]
    }
    const state = makeState(model, answers)
    expect(serializeResponse(model, state).status).toBe('completed')
  })
})

describe('serializeResponse — answer types', () => {
  it('serializes valueCoding correctly', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    const state = makeState(model, {
      'phq9.1': [coding('LA6569-3', 'http://loinc.org')],
    })
    const response = serializeResponse(model, state)
    const item = response.item.find(i => i.linkId === 'phq9.1')!
    expect(item.answer![0]).toEqual({ valueCoding: { code: 'LA6569-3', system: 'http://loinc.org' } })
  })

  it('serializes valueBoolean', () => {
    const model = parseQuestionnaire(goutFixture as Questionnaire)
    const state = makeState(model, { 'gout.on_ult': [bool(true)] })
    const response = serializeResponse(model, state)
    const item = response.item.find(i => i.linkId === 'gout.on_ult')!
    expect(item.answer![0]).toEqual({ valueBoolean: true })
  })

  it('serializes valueDecimal', () => {
    const model = parseQuestionnaire(goutFixture as Questionnaire)
    const state = makeState(model, { 'gout.uric_acid': [decimal(6.2)] })
    const response = serializeResponse(model, state)
    const item = response.item.find(i => i.linkId === 'gout.uric_acid')!
    expect(item.answer![0]).toEqual({ valueDecimal: 6.2 })
  })

  it('serializes valueDate', () => {
    const model = parseQuestionnaire(goutFixture as Questionnaire)
    const state = makeState(model, { 'gout.uric_acid_date': [dateVal('2026-03-01')] })
    const response = serializeResponse(model, state)
    const item = response.item.find(i => i.linkId === 'gout.uric_acid_date')!
    expect(item.answer![0]).toEqual({ valueDate: '2026-03-01' })
  })

  it('serializes valueString for text questions', () => {
    const model = parseQuestionnaire(goutFixture as Questionnaire)
    const state = makeState(model, { 'gout.notes': [str('Some notes here')] })
    const response = serializeResponse(model, state)
    const item = response.item.find(i => i.linkId === 'gout.notes')!
    expect(item.answer![0]).toEqual({ valueString: 'Some notes here' })
  })

  it('serializes multiple_choice as multiple valueCoding answers', () => {
    const model = parseQuestionnaire(goutFixture as Questionnaire)
    const state = makeState(model, {
      'gout.attack_joints': [coding('big_toe'), coding('ankle')],
    })
    const response = serializeResponse(model, state)
    const item = response.item.find(i => i.linkId === 'gout.attack_joints')!
    expect(item.answer).toHaveLength(2)
    expect(item.answer![0]).toEqual({ valueCoding: { code: 'big_toe', system: undefined } })
  })
})

describe('serializeResponse — skip logic exclusion', () => {
  it('excludes disabled items from output', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    const loinc = 'http://loinc.org'
    // All items answered "Not at all" → phq9.difficulty is disabled
    const answers: Record<string, AnswerValue[]> = {}
    for (let i = 1; i <= 9; i++) {
      answers[`phq9.${i}`] = [coding('LA6568-5', loinc)]
    }
    const state = makeState(model, answers)
    const response = serializeResponse(model, state)
    const difficulty = response.item.find(i => i.linkId === 'phq9.difficulty')
    expect(difficulty).toBeUndefined()
  })

  it('includes phq9.difficulty when any PHQ item is non-zero', () => {
    const model = parseQuestionnaire(phq9Fixture as Questionnaire)
    const loinc = 'http://loinc.org'
    const answers: Record<string, AnswerValue[]> = {}
    for (let i = 1; i <= 9; i++) {
      answers[`phq9.${i}`] = [coding('LA6568-5', loinc)]
    }
    // phq9.2 = "Several days"
    answers['phq9.2'] = [coding('LA6569-3', loinc)]
    answers['phq9.difficulty'] = [coding('0')]
    const state = makeState(model, answers)
    const response = serializeResponse(model, state)
    const difficulty = response.item.find(i => i.linkId === 'phq9.difficulty')
    expect(difficulty).toBeDefined()
    expect(difficulty!.answer![0]).toEqual({ valueCoding: { code: '0', system: undefined } })
  })
})

describe('serializeResponse — grid', () => {
  it('serializes grid as parent item with nested child items', () => {
    const model = parseQuestionnaire(goutFixture as Questionnaire)
    const state = makeState(model, {
      'gout.joint_severity.r0': [coding('0')],
      'gout.joint_severity.r1': [coding('2')],
    })
    const response = serializeResponse(model, state)
    const grid = response.item.find(i => i.linkId === 'gout.joint_severity')!
    expect(grid).toBeDefined()
    expect(grid.item).toHaveLength(2)
    expect(grid.item![0].linkId).toBe('gout.joint_severity.r0')
    expect(grid.item![0].answer![0]).toEqual({ valueCoding: { code: '0', system: undefined } })
  })
})

describe('serializeResponse — ranked', () => {
  it('serializes ranked answers with ordinalValue extensions', () => {
    const model = parseQuestionnaire(goutFixture as Questionnaire)
    const state = makeState(model, {
      'gout.treatment_priorities': [
        coding('prevention'),
        coding('uric_acid'),
        coding('pain_relief'),
      ],
    })
    const response = serializeResponse(model, state)
    const item = response.item.find(i => i.linkId === 'gout.treatment_priorities')!
    expect(item.answer).toHaveLength(3)
    expect(item.answer![0].valueCoding?.code).toBe('prevention')
    expect(item.answer![0].extension![0]).toEqual({
      url: 'http://hl7.org/fhir/StructureDefinition/ordinalValue',
      valueDecimal: 1,
    })
    expect(item.answer![1].extension![0].valueDecimal).toBe(2)
    expect(item.answer![2].extension![0].valueDecimal).toBe(3)
  })
})
