// Pure TypeScript skip logic engine. No React dependency.
// Evaluates FHIR enableWhen rules against current form answers.

import type { FormItem, EnableWhenRule, AnswerValue, FormState } from '../types/form'

function answerMatchesRule(answers: AnswerValue[], rule: EnableWhenRule): boolean {
  if (rule.operator === 'exists') {
    // value=true means "must exist"; value=false means "must not exist"
    const exists = answers.length > 0
    return rule.value === true ? exists : !exists
  }

  // For all other operators, test against each answer — any match satisfies
  return answers.some(answer => compareAnswer(answer, rule))
}

function compareAnswer(answer: AnswerValue, rule: EnableWhenRule): boolean {
  const { operator, value, system } = rule

  if (answer.type === 'coding') {
    // value is the code string; optionally constrained by system
    const codeMatches = answer.coding.code === value || answer.coding.display === value
    const systemMatches = system === undefined || answer.coding.system === system
    if (!codeMatches || !systemMatches) {
      return operator === '!='
    }
    return operator === '='
  }

  if (answer.type === 'boolean') {
    const ansVal = answer.value
    const ruleVal = typeof value === 'boolean' ? value : value === 'true'
    return evalOp(operator, ansVal, ruleVal)
  }

  if (answer.type === 'decimal' || answer.type === 'integer') {
    const ruleNum = typeof value === 'number' ? value : Number(value)
    if (isNaN(ruleNum)) return false
    return evalOp(operator, answer.value, ruleNum)
  }

  if (answer.type === 'date' || answer.type === 'datetime' || answer.type === 'string') {
    return evalOp(operator, answer.value, String(value))
  }

  return false
}

function evalOp<T>(operator: EnableWhenRule['operator'], a: T, b: T): boolean {
  switch (operator) {
    case '=':  return a === b
    case '!=': return a !== b
    case '>':  return a > b
    case '<':  return a < b
    case '>=': return a >= b
    case '<=': return a <= b
    default:   return false
  }
}

export function evaluateEnableWhen(
  item: FormItem,
  answers: Map<string, AnswerValue[]>
): boolean {
  if (!item.enableWhen || item.enableWhen.length === 0) return true

  const results = item.enableWhen.map(rule => {
    const triggerAnswers = answers.get(rule.question) ?? []
    return answerMatchesRule(triggerAnswers, rule)
  })

  if (item.enableBehavior === 'any') {
    return results.some(Boolean)
  }
  // default: 'all'
  return results.every(Boolean)
}

export function evaluateAll(
  items: FormItem[],
  answers: Map<string, AnswerValue[]>
): Map<string, boolean> {
  const enabled = new Map<string, boolean>()

  function walk(items: FormItem[]) {
    for (const item of items) {
      enabled.set(item.linkId, evaluateEnableWhen(item, answers))
      if (item.children) walk(item.children)
      if (item.gridConfig) {
        for (const row of item.gridConfig.rows) {
          // grid row cells inherit the parent's enabled state
          enabled.set(row.linkId, enabled.get(item.linkId) ?? true)
        }
      }
    }
  }

  walk(items)
  return enabled
}

// Returns linkIds of items that have become disabled and still have answers —
// the store should clear those answers.
export function findAnswersToDiscard(
  state: FormState,
  nextEnabled: Map<string, boolean>
): string[] {
  const toDiscard: string[] = []
  for (const [linkId, answers] of state.answers) {
    if (answers.length > 0 && nextEnabled.get(linkId) === false) {
      toDiscard.push(linkId)
    }
  }
  return toDiscard
}
