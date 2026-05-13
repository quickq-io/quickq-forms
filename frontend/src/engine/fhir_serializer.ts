// Converts FormState + FormModel into a valid FHIR R4 QuestionnaireResponse.
// Disabled items (skip logic) are excluded from the output.

import type { QuestionnaireResponse, ResponseItem, AnswerValue as FhirAnswerValue } from '../types/fhir'
import type { FormItem, FormModel, AnswerValue, FormState } from '../types/form'
import { groupChildKey } from '../store/form_store'

const ORDINAL_VALUE_URL = 'http://hl7.org/fhir/StructureDefinition/ordinalValue'

// Context for serializing an item that lives inside a repeating-group instance.
// When set, child answers are looked up under groupChildKey(parent, idx, child)
// rather than the child's bare linkId. Grid rows inside a repeating group use
// row.linkId as the *child*, scoped under the repeating-group parent + index.
interface InstanceContext {
  parentLinkId: string
  instanceIndex: number
}

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

function answersForLinkId(
  linkId: string,
  state: FormState,
  ctx: InstanceContext | undefined
): AnswerValue[] {
  const key = ctx ? groupChildKey(ctx.parentLinkId, ctx.instanceIndex, linkId) : linkId
  return state.answers.get(key) ?? []
}

function isEnabled(linkId: string, state: FormState, ctx: InstanceContext | undefined): boolean {
  const key = ctx ? groupChildKey(ctx.parentLinkId, ctx.instanceIndex, linkId) : linkId
  return state.enabled.get(key) ?? state.enabled.get(linkId) ?? true
}

// Serializes a single non-repeating item. Returns null when the item is
// disabled or has no answer worth emitting (empty answer arrays only at
// top-level group containers, which still emit their structural skeleton).
function serializeItem(
  item: FormItem,
  state: FormState,
  ctx?: InstanceContext
): ResponseItem | ResponseItem[] | null {
  if (!isEnabled(item.linkId, state, ctx)) return null

  if (item.type === 'instruction') {
    return null
  }

  if (item.type === 'section') {
    return serializeSection(item, state, ctx)
  }

  if (item.type === 'grid') {
    return serializeGrid(item, state, ctx)
  }

  if (item.type === 'repeating_group') {
    return serializeRepeatingGroup(item, state)
  }

  if (item.type === 'ranked') {
    return serializeRanked(item, state, ctx)
  }

  const answers = answersForLinkId(item.linkId, state, ctx)
  if (answers.length === 0) return null
  return {
    linkId: item.linkId,
    answer: answers.map(answerToFhir),
  }
}

function serializeSection(
  item: FormItem,
  state: FormState,
  ctx: InstanceContext | undefined
): ResponseItem | null {
  const children = item.children ?? []
  const items: ResponseItem[] = []
  for (const child of children) {
    const result = serializeItem(child, state, ctx)
    if (result === null) continue
    if (Array.isArray(result)) items.push(...result)
    else items.push(result)
  }
  if (items.length === 0) return null
  return { linkId: item.linkId, item: items }
}

function serializeGrid(
  item: FormItem,
  state: FormState,
  ctx: InstanceContext | undefined
): ResponseItem | null {
  const gridConfig = item.gridConfig!
  // Each grid row stores its own answer under row.linkId (or the keyed form
  // when the grid is a child of a repeating-group instance).
  const childItems: ResponseItem[] = []
  for (const row of gridConfig.rows) {
    const answers = answersForLinkId(row.linkId, state, ctx)
    if (answers.length === 0) continue
    childItems.push({ linkId: row.linkId, answer: answers.map(answerToFhir) })
  }

  if (childItems.length === 0) return null
  return {
    linkId: item.linkId,
    item: childItems,
  }
}

// Emits one ResponseItem per repeating-group instance, all sharing the same
// linkId. The quickq importer relies on this shape: each top-level item with
// the repeating_group linkId increments the per-group repeat_index.
function serializeRepeatingGroup(item: FormItem, state: FormState): ResponseItem[] {
  const children = item.children ?? []
  const instanceCount = state.groupInstances.get(item.linkId) ?? 1

  const instances: ResponseItem[] = []
  for (let i = 0; i < instanceCount; i++) {
    const ctx: InstanceContext = { parentLinkId: item.linkId, instanceIndex: i }
    const instanceItems: ResponseItem[] = []
    for (const child of children) {
      const result = serializeItem(child, state, ctx)
      if (result === null) continue
      if (Array.isArray(result)) {
        // Nested repeating_group inside a repeating_group is unsupported by
        // the importer; the parser already prevents it but emit defensively.
        instanceItems.push(...result)
      } else {
        instanceItems.push(result)
      }
    }
    if (instanceItems.length > 0) {
      instances.push({ linkId: item.linkId, item: instanceItems })
    }
  }
  return instances
}

function serializeRanked(
  item: FormItem,
  state: FormState,
  ctx: InstanceContext | undefined
): ResponseItem | null {
  const answers = answersForLinkId(item.linkId, state, ctx)
  if (answers.length === 0) return null
  const fhirAnswers: FhirAnswerValue[] = answers.map((answer, index) => ({
    ...answerToFhir(answer),
    extension: [{ url: ORDINAL_VALUE_URL, valueDecimal: index + 1 }],
  }))
  return { linkId: item.linkId, answer: fhirAnswers }
}

export function serializeResponse(
  model: FormModel,
  state: FormState,
  options: { status?: QuestionnaireResponse['status']; respondentId?: string | null } = {}
): QuestionnaireResponse {
  const items: ResponseItem[] = []
  for (const item of model.items) {
    const result = serializeItem(item, state)
    if (result === null) continue
    if (Array.isArray(result)) {
      items.push(...result)
    } else {
      items.push(result)
    }
  }

  // Status: completed if all required enabled items have answers
  let status = options.status ?? 'in-progress'
  if (status === 'in-progress') {
    const allRequiredAnswered = model.items.every(item => {
      if (!item.required) return true
      if (!isEnabled(item.linkId, state, undefined)) return true
      const answers = state.answers.get(item.linkId) ?? []
      return answers.length > 0
    })
    if (allRequiredAnswered) status = 'completed'
  }

  const response: QuestionnaireResponse = {
    resourceType: 'QuestionnaireResponse',
    questionnaire: model.questionnaireUrl || undefined,
    status,
    authored: new Date().toISOString(),
    item: items,
  }
  if (options.respondentId) {
    // FHIR convention: subject.reference is `Patient/<id>`. The quickq importer
    // splits on `/` and stores the suffix as respondent.external_id.
    response.subject = { reference: `Patient/${options.respondentId}` }
  }
  return response
}
