// Internal representation used by the form engine and components.
// The parser converts a FHIR Questionnaire into a FormModel.
// The serializer converts FormState back into a QuestionnaireResponse.

import type { Coding, EnableWhen } from './fhir'

export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'sata_other'
  | 'boolean'
  | 'text'
  | 'numeric'
  | 'date'
  | 'datetime'
  | 'likert'
  | 'grid'
  | 'slider'
  | 'ranked'
  | 'repeating_group'

export interface ResponseOption {
  code: string
  display: string
  system?: string
}

export interface NumericConfig {
  min?: number
  max?: number
  step?: number
  isInteger: boolean
}

export interface SliderConfig {
  min: number
  max: number
  step?: number
  minLabel?: string
  maxLabel?: string
}

export interface GridConfig {
  // rows and columns are the sub-item linkIds and their display text
  rows: { linkId: string; text: string }[]
  columns: ResponseOption[]
}

export interface EnableWhenRule {
  question: string
  operator: EnableWhen['operator']
  // the answer value to test — string covers coding code, date, dateTime; number for decimals
  value: string | number | boolean | null
  // for coding comparisons, track the system too
  system?: string
}

export interface FormItem {
  linkId: string
  text: string
  type: QuestionType
  required: boolean

  // choice / likert / ranked / sata_other / multiple_choice
  options?: ResponseOption[]

  // numeric
  numericConfig?: NumericConfig

  // slider
  sliderConfig?: SliderConfig

  // grid
  gridConfig?: GridConfig

  // repeating_group: child items repeated per instance
  children?: FormItem[]

  // skip logic
  enableWhen?: EnableWhenRule[]
  enableBehavior: 'all' | 'any'
}

export interface FormModel {
  questionnaireUrl: string
  title: string
  // top-level items in display order; grid sub-rows are inside gridConfig
  items: FormItem[]
}

// AnswerValue mirrors the FHIR answer union but as a plain object
export type AnswerValue =
  | { type: 'coding'; coding: Coding }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'decimal'; value: number }
  | { type: 'integer'; value: number }
  | { type: 'date'; value: string }
  | { type: 'datetime'; value: string }

export interface FormState {
  // linkId → list of answers (most questions have 1; multi-select has many; ranked has N)
  answers: Map<string, AnswerValue[]>
  // linkId → currently enabled
  enabled: Map<string, boolean>
  // parentLinkId → instance count (min 1) for repeating_group items
  groupInstances: Map<string, number>
}
