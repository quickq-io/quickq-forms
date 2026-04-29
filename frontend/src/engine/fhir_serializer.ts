// Converts FormState + FormModel into a valid FHIR R4 QuestionnaireResponse.
// Disabled items (skip logic) are excluded from the output.

import type { QuestionnaireResponse, ResponseItem, AnswerValue as FhirAnswerValue } from '../types/fhir'
import type { FormItem, FormModel, AnswerValue, FormState } from '../types/form'

const ORDINAL_VALUE_URL = 'http://hl7.org/fhir/StructureDefinition/ordinalValue'

function answerToFhir(answer: AnswerValue): FhirAnswerValue {
  switch (answer.type) {
    case 'coding':
      return { valueCoding: answer.coding }
    case 'string':
      return { valueString: answer.value }
    case 'boolean':
      return { valueBoolean: answer.value }
    case 'decimal':
      return { valueDecimal: answer.value }
    case 'integer':
      return { valueInteger: answer.value }
    case 'date':
      return { valueDate: answer.value }
    case 'datetime':
      return { valueDateTime: answer.value }
  }
}

function serializeItem(
  item: FormItem,
  state: FormState
): ResponseItem | null {
  const isEnabled = state.enabled.get(item.linkId) ?? true
  if (!isEnabled) return null

  if (item.type === 'grid') {
    return serializeGrid(item, state)
  }

  if (item.type === 'repeating_group') {
    return serializeRepeatingGroup(item, state)
  }

  if (item.type === 'ranked') {
    return serializeRanked(item, state)
  }

  const answers = state.answers.get(item.linkId) ?? []
  return {
    linkId: item.linkId,
    answer: answers.map(answerToFhir),
  }
}

function serializeGrid(item: FormItem, state: FormState): ResponseItem {
  const gridConfig = item.gridConfig!
  const childItems: ResponseItem[] = gridConfig.rows
    .map(row => {
      const answers = state.answers.get(row.linkId) ?? []
      return {
        linkId: row.linkId,
        answer: answers.map(answerToFhir),
      }
    })
    .filter(ri => ri.answer.length > 0)

  return {
    linkId: item.linkId,
    answer: [],
    item: childItems,
  }
}

function serializeRepeatingGroup(item: FormItem, state: FormState): ResponseItem {
  // Each instance is stored under keys `{parentLinkId}[{i}]:{childLinkId}`.
  // In FHIR QuestionnaireResponse, each instance becomes a separate item entry
  // with the same parent linkId (group with repeats=true).
  // We emit them as nested item entries within a single parent for now.
  const children = item.children ?? []
  const instanceCount = state.groupInstances.get(item.linkId) ?? 1

  const allInstanceItems: ResponseItem[] = []
  for (let i = 0; i < instanceCount; i++) {
    const instanceChildren: ResponseItem[] = children
      .map(child => {
        const key = `${item.linkId}[${i}]:${child.linkId}`
        const answers = state.answers.get(key) ?? []
        return { linkId: child.linkId, answer: answers.map(answerToFhir) }
      })
      .filter(ri => ri.answer.length > 0)

    if (instanceChildren.length > 0) {
      allInstanceItems.push(...instanceChildren)
    }
  }

  return { linkId: item.linkId, item: allInstanceItems }
}

function serializeRanked(item: FormItem, state: FormState): ResponseItem {
  // Ranked answers: list of coding answers, each with an ordinalValue extension (1-based rank)
  const answers = state.answers.get(item.linkId) ?? []
  const fhirAnswers: FhirAnswerValue[] = answers.map((answer, index) => {
    const base = answerToFhir(answer)
    return {
      ...base,
      extension: [
        { url: ORDINAL_VALUE_URL, valueDecimal: index + 1 },
      ],
    }
  })
  return { linkId: item.linkId, answer: fhirAnswers }
}

export function serializeResponse(
  model: FormModel,
  state: FormState,
  options: { status?: QuestionnaireResponse['status'] } = {}
): QuestionnaireResponse {
  const items: ResponseItem[] = model.items
    .map(item => serializeItem(item, state))
    .filter((item): item is ResponseItem => item !== null)

  // Determine status: completed if all required enabled items have answers
  let status = options.status ?? 'in-progress'
  if (status === 'in-progress') {
    const allRequiredAnswered = model.items.every(item => {
      if (!item.required) return true
      const isEnabled = state.enabled.get(item.linkId) ?? true
      if (!isEnabled) return true
      const answers = state.answers.get(item.linkId) ?? []
      return answers.length > 0
    })
    if (allRequiredAnswered) status = 'completed'
  }

  return {
    resourceType: 'QuestionnaireResponse',
    questionnaire: model.questionnaireUrl || undefined,
    status,
    authored: new Date().toISOString(),
    item: items,
  }
}
