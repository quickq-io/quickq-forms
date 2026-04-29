import { describe, it, expect } from 'vitest'
import { evaluateEnableWhen, evaluateAll, findAnswersToDiscard } from '../engine/skip_logic'
import type { FormItem, AnswerValue, FormState } from '../types/form'

function choiceItem(linkId: string, rules?: FormItem['enableWhen'], behavior?: 'all' | 'any'): FormItem {
  return {
    linkId,
    text: linkId,
    type: 'single_choice',
    required: false,
    enableBehavior: behavior ?? 'all',
    enableWhen: rules,
  }
}

function answers(...vals: AnswerValue[]): AnswerValue[] {
  return vals
}

const coding = (code: string, system?: string): AnswerValue => ({
  type: 'coding',
  coding: { code, system },
})

const str = (value: string): AnswerValue => ({ type: 'string', value })
const bool = (value: boolean): AnswerValue => ({ type: 'boolean', value })
const num = (value: number): AnswerValue => ({ type: 'decimal', value })
const integer = (value: number): AnswerValue => ({ type: 'integer', value })

describe('evaluateEnableWhen', () => {
  it('returns true when no enableWhen rules', () => {
    const item = choiceItem('q1')
    expect(evaluateEnableWhen(item, new Map())).toBe(true)
  })

  describe('exists operator', () => {
    it('value=true: enabled when answer present', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: 'exists', value: true }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(coding('a'))]]))).toBe(true)
    })

    it('value=true: disabled when no answer', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: 'exists', value: true }])
      expect(evaluateEnableWhen(item, new Map())).toBe(false)
    })

    it('value=false: enabled when no answer', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: 'exists', value: false }])
      expect(evaluateEnableWhen(item, new Map())).toBe(true)
    })

    it('value=false: disabled when answer present', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: 'exists', value: false }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(coding('a'))]]))).toBe(false)
    })
  })

  describe('= operator with coding', () => {
    const rules = [{ question: 'q1', operator: '=' as const, value: 'yes' }]

    it('enabled when coding code matches', () => {
      const item = choiceItem('q2', rules)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(coding('yes'))]]))).toBe(true)
    })

    it('disabled when coding code does not match', () => {
      const item = choiceItem('q2', rules)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(coding('no'))]]))).toBe(false)
    })

    it('disabled when no answer', () => {
      const item = choiceItem('q2', rules)
      expect(evaluateEnableWhen(item, new Map())).toBe(false)
    })
  })

  describe('!= operator with coding', () => {
    it('enabled when code does not match', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '!=', value: 'LA6568-5', system: 'http://loinc.org' }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(coding('LA6569-3', 'http://loinc.org'))]]))).toBe(true)
    })

    it('disabled when code matches', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '!=', value: 'LA6568-5', system: 'http://loinc.org' }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(coding('LA6568-5', 'http://loinc.org'))]]))).toBe(false)
    })
  })

  describe('numeric operators', () => {
    it('> operator', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '>', value: 5 }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(6))]]))).toBe(true)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(5))]]))).toBe(false)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(4))]]))).toBe(false)
    })

    it('>= operator', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '>=', value: 5 }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(5))]]))).toBe(true)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(4))]]))).toBe(false)
    })

    it('< operator', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '<', value: 5 }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(4))]]))).toBe(true)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(5))]]))).toBe(false)
    })

    it('<= operator', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '<=', value: 5 }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(5))]]))).toBe(true)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(num(6))]]))).toBe(false)
    })

    it('works with integer type answers', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '>', value: 3 }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(integer(4))]]))).toBe(true)
    })
  })

  describe('boolean answers', () => {
    it('= true', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '=', value: true }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(bool(true))]]))).toBe(true)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(bool(false))]]))).toBe(false)
    })
  })

  describe('string answers', () => {
    it('= operator', () => {
      const item = choiceItem('q2', [{ question: 'q1', operator: '=', value: 'foo' }])
      expect(evaluateEnableWhen(item, new Map([['q1', answers(str('foo'))]]))).toBe(true)
      expect(evaluateEnableWhen(item, new Map([['q1', answers(str('bar'))]]))).toBe(false)
    })
  })

  describe('enableBehavior: all (AND)', () => {
    it('enabled only when all rules pass', () => {
      const item = choiceItem('q3', [
        { question: 'q1', operator: '=', value: 'yes' },
        { question: 'q2', operator: '=', value: 'yes' },
      ], 'all')
      const allYes = new Map([['q1', answers(coding('yes'))], ['q2', answers(coding('yes'))]])
      const oneYes = new Map([['q1', answers(coding('yes'))], ['q2', answers(coding('no'))]])
      expect(evaluateEnableWhen(item, allYes)).toBe(true)
      expect(evaluateEnableWhen(item, oneYes)).toBe(false)
    })
  })

  describe('enableBehavior: any (OR)', () => {
    it('enabled when any rule passes', () => {
      const item = choiceItem('q3', [
        { question: 'q1', operator: '!=', value: 'LA6568-5', system: 'http://loinc.org' },
        { question: 'q2', operator: '!=', value: 'LA6568-5', system: 'http://loinc.org' },
        { question: 'q3_other', operator: '!=', value: 'LA6568-5', system: 'http://loinc.org' },
      ], 'any')
      // Only q2 passes
      const map = new Map([
        ['q1', answers(coding('LA6568-5', 'http://loinc.org'))],
        ['q2', answers(coding('LA6569-3', 'http://loinc.org'))],
        ['q3_other', answers(coding('LA6568-5', 'http://loinc.org'))],
      ])
      expect(evaluateEnableWhen(item, map)).toBe(true)
    })

    it('disabled when no rules pass', () => {
      const item = choiceItem('q3', [
        { question: 'q1', operator: '!=', value: 'LA6568-5' },
        { question: 'q2', operator: '!=', value: 'LA6568-5' },
      ], 'any')
      const map = new Map([
        ['q1', answers(coding('LA6568-5'))],
        ['q2', answers(coding('LA6568-5'))],
      ])
      expect(evaluateEnableWhen(item, map)).toBe(false)
    })
  })
})

describe('evaluateAll', () => {
  it('marks all items enabled when no enableWhen', () => {
    const items: FormItem[] = [
      choiceItem('q1'),
      choiceItem('q2'),
    ]
    const enabled = evaluateAll(items, new Map())
    expect(enabled.get('q1')).toBe(true)
    expect(enabled.get('q2')).toBe(true)
  })

  it('cascading dependency: A controls B controls C', () => {
    const items: FormItem[] = [
      choiceItem('a'),
      choiceItem('b', [{ question: 'a', operator: '=', value: 'yes' }]),
      choiceItem('c', [{ question: 'b', operator: 'exists', value: true }]),
    ]
    // a=yes → b enabled → c depends on b having an answer
    const withA = new Map<string, AnswerValue[]>([['a', [coding('yes')]]])
    const enabled = evaluateAll(items, withA)
    expect(enabled.get('a')).toBe(true)
    expect(enabled.get('b')).toBe(true)
    // c: b is enabled but has no answer in the map
    expect(enabled.get('c')).toBe(false)
  })

  it('PHQ-9 difficulty item uses any-OR on 3 trigger items', () => {
    // difficulty is shown if any of phq9.1, phq9.2, phq9.3 != 'LA6568-5'
    const difficulty: FormItem = {
      linkId: 'phq9.difficulty',
      text: 'How difficult?',
      type: 'single_choice',
      required: false,
      enableBehavior: 'any',
      enableWhen: [
        { question: 'phq9.1', operator: '!=', value: 'LA6568-5', system: 'http://loinc.org' },
        { question: 'phq9.2', operator: '!=', value: 'LA6568-5', system: 'http://loinc.org' },
        { question: 'phq9.3', operator: '!=', value: 'LA6568-5', system: 'http://loinc.org' },
      ],
    }
    const items: FormItem[] = [choiceItem('phq9.1'), choiceItem('phq9.2'), choiceItem('phq9.3'), difficulty]

    // All answer "Not at all" → difficulty hidden
    const allNotAtAll = new Map<string, AnswerValue[]>([
      ['phq9.1', [coding('LA6568-5', 'http://loinc.org')]],
      ['phq9.2', [coding('LA6568-5', 'http://loinc.org')]],
      ['phq9.3', [coding('LA6568-5', 'http://loinc.org')]],
    ])
    expect(evaluateAll(items, allNotAtAll).get('phq9.difficulty')).toBe(false)

    // phq9.2 answers "Several days" → difficulty shown
    const oneNonZero = new Map<string, AnswerValue[]>([
      ['phq9.1', [coding('LA6568-5', 'http://loinc.org')]],
      ['phq9.2', [coding('LA6569-3', 'http://loinc.org')]],
      ['phq9.3', [coding('LA6568-5', 'http://loinc.org')]],
    ])
    expect(evaluateAll(items, oneNonZero).get('phq9.difficulty')).toBe(true)
  })
})

describe('findAnswersToDiscard', () => {
  it('returns linkIds with answers that are now disabled', () => {
    const state: FormState = {
      answers: new Map([
        ['q1', [coding('yes')]],
        ['q2', [str('some text')]],
        ['q3', []],
      ]),
      enabled: new Map([['q1', true], ['q2', false], ['q3', false]]),
      groupInstances: new Map(),
    }
    const nextEnabled = new Map([['q1', true], ['q2', false], ['q3', false]])
    const toDiscard = findAnswersToDiscard(state, nextEnabled)
    // q2 has answers and is disabled; q3 has no answers so nothing to discard
    expect(toDiscard).toContain('q2')
    expect(toDiscard).not.toContain('q1')
    expect(toDiscard).not.toContain('q3')
  })
})
