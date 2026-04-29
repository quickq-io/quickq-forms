import { describe, it, expect } from 'vitest'
import { parseQuestionnaire } from '../engine/fhir_parser'
import type { Questionnaire } from '../types/fhir'

import phq9 from './fixtures/phq9_fhir_questionnaire.json'
import goutCheckin from './fixtures/gout_checkin_fhir_questionnaire.json'
import prapare from './fixtures/prapare_fhir_questionnaire.json'
import promis10 from './fixtures/promis10_fhir_questionnaire.json'

describe('parseQuestionnaire — PHQ-9', () => {
  const model = parseQuestionnaire(phq9 as Questionnaire)

  it('parses title and url', () => {
    expect(model.title).toBe('PHQ-9 Patient Health Questionnaire')
    expect(model.questionnaireUrl).toBe('http://quickq.io/instruments/phq9')
  })

  it('produces 10 items', () => {
    expect(model.items).toHaveLength(10)
  })

  it('first item is single_choice with 4 options', () => {
    const item = model.items[0]
    expect(item.linkId).toBe('phq9.1')
    expect(item.type).toBe('single_choice')
    expect(item.required).toBe(true)
    expect(item.options).toHaveLength(4)
    expect(item.options![0]).toEqual({
      code: 'LA6568-5',
      display: 'Not at all',
      system: 'http://loinc.org',
    })
  })

  it('difficulty item has enableWhen rules with any behavior', () => {
    const difficulty = model.items.find(i => i.linkId === 'phq9.difficulty')!
    expect(difficulty.enableWhen).toHaveLength(3)
    expect(difficulty.enableBehavior).toBe('any')
    expect(difficulty.enableWhen![0]).toEqual({
      question: 'phq9.1',
      operator: '!=',
      value: 'LA6568-5',
      system: 'http://loinc.org',
    })
  })
})

describe('parseQuestionnaire — Gout Check-In', () => {
  const model = parseQuestionnaire(goutCheckin as Questionnaire)

  it('parses date question', () => {
    const item = model.items.find(i => i.linkId === 'gout.last_attack_date')!
    expect(item.type).toBe('date')
  })

  it('parses decimal/numeric question with min constraint', () => {
    const item = model.items.find(i => i.linkId === 'gout.attacks_12mo')!
    expect(item.type).toBe('numeric')
    expect(item.numericConfig?.min).toBe(0)
    expect(item.numericConfig?.isInteger).toBe(false)
  })

  it('parses multiple_choice (choice + repeats)', () => {
    const item = model.items.find(i => i.linkId === 'gout.attack_joints')!
    expect(item.type).toBe('multiple_choice')
    expect(item.options).toHaveLength(6)
    expect(item.options![0].code).toBe('big_toe')
  })

  it('parses grid question with rows and columns', () => {
    const item = model.items.find(i => i.linkId === 'gout.joint_severity')!
    expect(item.type).toBe('grid')
    expect(item.gridConfig!.rows).toHaveLength(6)
    expect(item.gridConfig!.columns).toHaveLength(4)
    expect(item.gridConfig!.columns[0]).toEqual({ code: '0', display: 'None', system: undefined })
    expect(item.gridConfig!.rows[0].linkId).toBe('gout.joint_severity.r0')
    expect(item.gridConfig!.rows[0].text).toBe('Right big toe')
  })

  it('parses boolean question', () => {
    const item = model.items.find(i => i.linkId === 'gout.on_ult')!
    expect(item.type).toBe('boolean')
  })

  it('parses ranked question', () => {
    const item = model.items.find(i => i.linkId === 'gout.treatment_priorities')!
    expect(item.type).toBe('ranked')
    expect(item.options).toHaveLength(5)
    expect(item.options![0].code).toBe('pain_relief')
  })

  it('parses text question', () => {
    const item = model.items.find(i => i.linkId === 'gout.notes')!
    expect(item.type).toBe('text')
  })

  it('parses numeric with min and max', () => {
    const item = model.items.find(i => i.linkId === 'gout.uric_acid')!
    expect(item.type).toBe('numeric')
    expect(item.numericConfig?.min).toBe(0)
    expect(item.numericConfig?.max).toBe(30)
  })
})

describe('parseQuestionnaire — PRAPARE', () => {
  const model = parseQuestionnaire(prapare as Questionnaire)

  it('parses sata_other (open-choice)', () => {
    const item = model.items.find(i => i.linkId === 'prapare.necessities')!
    expect(item.type).toBe('sata_other')
    expect(item.options).toHaveLength(8)
  })

  it('parses boolean', () => {
    const item = model.items.find(i => i.linkId === 'prapare.transportation')!
    expect(item.type).toBe('boolean')
  })
})

describe('parseQuestionnaire — PROMIS-10', () => {
  const model = parseQuestionnaire(promis10 as Questionnaire)

  it('parses slider (integer + itemControl=slider)', () => {
    const item = model.items.find(i => i.linkId === 'promis10.g7')!
    expect(item.type).toBe('slider')
    expect(item.sliderConfig?.min).toBe(0)
    expect(item.sliderConfig?.max).toBe(10)
  })

  it('parses regular choice items as single_choice', () => {
    const item = model.items.find(i => i.linkId === 'promis10.g1')!
    expect(item.type).toBe('single_choice')
    expect(item.options).toHaveLength(5)
  })
})

describe('parseQuestionnaire — likert extension', () => {
  it('detects likert via quickq extension', () => {
    const likertQuestionnaire: Questionnaire = {
      resourceType: 'Questionnaire',
      url: 'http://example.com/test',
      title: 'Test',
      item: [{
        linkId: 'q1',
        text: 'How satisfied are you?',
        type: 'choice',
        answerOption: [
          { valueCoding: { code: '1', display: 'Very unsatisfied' } },
          { valueCoding: { code: '2', display: 'Unsatisfied' } },
          { valueCoding: { code: '3', display: 'Neutral' } },
          { valueCoding: { code: '4', display: 'Satisfied' } },
          { valueCoding: { code: '5', display: 'Very satisfied' } },
        ],
        extension: [
          { url: 'https://quickq.io/fhir/StructureDefinition/likert', valueBoolean: true },
        ],
      }],
    }
    const model = parseQuestionnaire(likertQuestionnaire)
    expect(model.items[0].type).toBe('likert')
    expect(model.items[0].options).toHaveLength(5)
  })
})

describe('parseQuestionnaire — error handling', () => {
  it('throws on wrong resourceType', () => {
    expect(() =>
      parseQuestionnaire({ resourceType: 'Patient' } as unknown as Questionnaire)
    ).toThrow('Expected resourceType "Questionnaire"')
  })

  it('items with no enableWhen default to always enabled', () => {
    const model = parseQuestionnaire(phq9 as Questionnaire)
    const item = model.items[0]
    expect(item.enableWhen).toBeUndefined()
    expect(item.enableBehavior).toBe('all')
  })
})
