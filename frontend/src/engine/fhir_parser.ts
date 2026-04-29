// Converts a FHIR R4 Questionnaire into the internal FormModel used by the
// form engine and components.

import type {
  Questionnaire,
  QuestionnaireItem,
  AnswerOption,
  Extension,
  EnableWhen,
} from '../types/fhir'
import type {
  FormModel,
  FormItem,
  QuestionType,
  ResponseOption,
  NumericConfig,
  SliderConfig,
  GridConfig,
  EnableWhenRule,
} from '../types/form'

const QUICKQ_EXT = 'https://quickq.io/fhir/StructureDefinition'
const HL7_ITEM_CONTROL = 'http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl'
const HL7_MIN = 'http://hl7.org/fhir/StructureDefinition/minValue'
const HL7_MAX = 'http://hl7.org/fhir/StructureDefinition/maxValue'
const HL7_STEP = `${QUICKQ_EXT}/numeric-step`

function ext(extensions: Extension[] | undefined, url: string): Extension | undefined {
  return extensions?.find(e => e.url === url)
}

function itemControlCode(extensions: Extension[] | undefined): string | undefined {
  const e = ext(extensions, HL7_ITEM_CONTROL)
  return e?.valueCodeableConcept?.coding?.[0]?.code
}

function detectType(item: QuestionnaireItem): QuestionType {
  const { type, repeats, extension: exts } = item

  // ranked: choice + quickq ranked-choice extension
  if (type === 'choice' && ext(exts, `${QUICKQ_EXT}/ranked-choice`)?.valueBoolean === true) {
    return 'ranked'
  }

  // likert: choice + quickq likert extension
  if (type === 'choice' && ext(exts, `${QUICKQ_EXT}/likert`)?.valueBoolean === true) {
    return 'likert'
  }

  // slider: integer + SDC itemControl = slider
  if ((type === 'integer' || type === 'decimal') && itemControlCode(exts) === 'slider') {
    return 'slider'
  }

  // grid: group + SDC itemControl = gtable
  if (type === 'group' && itemControlCode(exts) === 'gtable') {
    return 'grid'
  }

  // repeating_group: group + repeats
  if (type === 'group' && repeats) {
    return 'repeating_group'
  }

  // sata_other: open-choice
  if (type === 'open-choice') {
    return 'sata_other'
  }

  // multiple_choice: choice + repeats
  if (type === 'choice' && repeats) {
    return 'multiple_choice'
  }

  switch (type) {
    case 'choice':   return 'single_choice'
    case 'boolean':  return 'boolean'
    case 'text':
    case 'string':   return 'text'
    case 'decimal':  return 'numeric'
    case 'integer':  return 'numeric'
    case 'date':     return 'date'
    case 'dateTime': return 'datetime'
    case 'group':    return 'single_choice' // unexpected plain group — treat as unsupported
    default:
      throw new Error(`Unsupported FHIR item type: ${type} (linkId: ${item.linkId})`)
  }
}

function parseOptions(answerOption: AnswerOption[] | undefined): ResponseOption[] {
  if (!answerOption) return []
  return answerOption.map(opt => ({
    code: opt.valueCoding.code ?? opt.valueCoding.display ?? '',
    display: opt.valueCoding.display ?? opt.valueCoding.code ?? '',
    system: opt.valueCoding.system,
  }))
}

function parseNumericConfig(item: QuestionnaireItem, isInteger: boolean): NumericConfig {
  const minExt = ext(item.extension, HL7_MIN)
  const maxExt = ext(item.extension, HL7_MAX)
  const stepExt = ext(item.extension, HL7_STEP)

  const minVal = isInteger ? minExt?.valueInteger : minExt?.valueDecimal
  const maxVal = isInteger ? maxExt?.valueInteger : maxExt?.valueDecimal
  const stepVal = stepExt?.valueDecimal

  return {
    min: minVal,
    max: maxVal,
    step: stepVal,
    isInteger,
  }
}

function parseSliderConfig(item: QuestionnaireItem): SliderConfig {
  const minExt = ext(item.extension, HL7_MIN)
  const maxExt = ext(item.extension, HL7_MAX)
  const stepExt = ext(item.extension, HL7_STEP)
  const minLabelExt = ext(item.extension, `${QUICKQ_EXT}/slider-min-label`)
  const maxLabelExt = ext(item.extension, `${QUICKQ_EXT}/slider-max-label`)

  return {
    min: minExt?.valueInteger ?? minExt?.valueDecimal ?? 0,
    max: maxExt?.valueInteger ?? maxExt?.valueDecimal ?? 100,
    step: stepExt?.valueDecimal,
    minLabel: minLabelExt?.valueString,
    maxLabel: maxLabelExt?.valueString,
  }
}

function parseGridConfig(item: QuestionnaireItem): GridConfig {
  // In the FHIR export, each child item has the same answerOption list (the columns).
  // Rows are derived from the child items; columns from the first child's answerOption.
  const children = item.item ?? []
  if (children.length === 0) {
    throw new Error(`Grid item ${item.linkId} has no child items`)
  }
  const rows = children.map(child => ({
    linkId: child.linkId,
    text: child.text ?? child.linkId,
  }))
  const columns = parseOptions(children[0].answerOption)
  return { rows, columns }
}

function parseEnableWhen(rules: EnableWhen[]): EnableWhenRule[] {
  return rules.map(rule => {
    let value: string | number | boolean | null = null
    let system: string | undefined

    if (rule.answerCoding !== undefined) {
      value = rule.answerCoding.code ?? rule.answerCoding.display ?? ''
      system = rule.answerCoding.system
    } else if (rule.answerBoolean !== undefined) {
      value = rule.answerBoolean
    } else if (rule.answerDecimal !== undefined) {
      value = rule.answerDecimal
    } else if (rule.answerInteger !== undefined) {
      value = rule.answerInteger
    } else if (rule.answerDate !== undefined) {
      value = rule.answerDate
    } else if (rule.answerDateTime !== undefined) {
      value = rule.answerDateTime
    } else if (rule.answerString !== undefined) {
      value = rule.answerString
    }

    return { question: rule.question, operator: rule.operator, value, system }
  })
}

function parseItem(item: QuestionnaireItem): FormItem {
  const questionType = detectType(item)
  const enableWhen = item.enableWhen ? parseEnableWhen(item.enableWhen) : undefined

  const base: FormItem = {
    linkId: item.linkId,
    text: item.text ?? '',
    type: questionType,
    required: item.required ?? false,
    enableBehavior: item.enableBehavior ?? 'all',
  }

  if (enableWhen) base.enableWhen = enableWhen

  switch (questionType) {
    case 'single_choice':
    case 'multiple_choice':
    case 'sata_other':
    case 'likert':
    case 'ranked':
      base.options = parseOptions(item.answerOption)
      break

    case 'numeric':
      base.numericConfig = parseNumericConfig(item, item.type === 'integer')
      break

    case 'slider':
      base.sliderConfig = parseSliderConfig(item)
      break

    case 'grid':
      base.gridConfig = parseGridConfig(item)
      break

    case 'repeating_group':
      base.children = (item.item ?? []).map(parseItem)
      break

    case 'boolean':
    case 'text':
    case 'date':
    case 'datetime':
      // no extra config needed
      break
  }

  return base
}

export function parseQuestionnaire(questionnaire: Questionnaire): FormModel {
  if (questionnaire.resourceType !== 'Questionnaire') {
    throw new Error(
      `Expected resourceType "Questionnaire", got "${questionnaire.resourceType}"`
    )
  }

  const items = (questionnaire.item ?? [])
    .filter(item => item.type !== 'display')
    .map(parseItem)

  return {
    questionnaireUrl: questionnaire.url ?? '',
    title: questionnaire.title ?? questionnaire.name ?? '',
    items,
  }
}
