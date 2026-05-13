// FHIR R4 type definitions covering the subset emitted by quickq export_fhir().
// Only fields that quickq actually produces are typed here; additional FHIR
// fields are allowed by the index signatures on Extension.

export type FhirItemType =
  | 'group'
  | 'display'
  | 'boolean'
  | 'decimal'
  | 'integer'
  | 'date'
  | 'dateTime'
  | 'time'
  | 'string'
  | 'text'
  | 'url'
  | 'choice'
  | 'open-choice'
  | 'attachment'
  | 'reference'
  | 'quantity'

export interface Coding {
  system?: string
  code?: string
  display?: string
}

export interface Extension {
  url: string
  valueString?: string
  valueBoolean?: boolean
  valueDecimal?: number
  valueInteger?: number
  valueCodeableConcept?: { coding: Coding[] }
  // nested extensions (used for scoring-rule on Questionnaire root)
  extension?: Extension[]
}

export interface AnswerOption {
  valueCoding: Coding
}

export interface EnableWhen {
  question: string
  operator: 'exists' | '=' | '!=' | '>' | '<' | '>=' | '<='
  // exactly one of these is present
  answerBoolean?: boolean
  answerDecimal?: number
  answerInteger?: number
  answerDate?: string
  answerDateTime?: string
  answerString?: string
  answerCoding?: Coding
}

export interface QuestionnaireItem {
  linkId: string
  text?: string
  type: FhirItemType
  required?: boolean
  repeats?: boolean
  answerOption?: AnswerOption[]
  answerValueSet?: string
  enableWhen?: EnableWhen[]
  enableBehavior?: 'all' | 'any'
  item?: QuestionnaireItem[]
  extension?: Extension[]
}

export interface Questionnaire {
  resourceType: 'Questionnaire'
  url?: string
  name?: string
  title?: string
  version?: string
  status?: string
  description?: string
  date?: string
  item?: QuestionnaireItem[]
  extension?: Extension[]
}

// QuestionnaireResponse types — what the serializer produces
export interface AnswerValue {
  valueString?: string
  valueBoolean?: boolean
  valueDecimal?: number
  valueInteger?: number
  valueDate?: string
  valueDateTime?: string
  valueCoding?: Coding
  extension?: Extension[]
}

export interface ResponseItem {
  linkId: string
  answer?: AnswerValue[]
  item?: ResponseItem[]
}

export interface Reference {
  reference?: string
}

export interface QuestionnaireResponse {
  resourceType: 'QuestionnaireResponse'
  questionnaire?: string
  status: 'completed' | 'in-progress' | 'amended' | 'stopped'
  authored?: string
  subject?: Reference
  item: ResponseItem[]
}
