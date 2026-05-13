// React context shared by Form and its descendants. Carries display-only
// derived state that components otherwise have no clean way to access
// (numbering map, the set of linkIds flagged as missing-required after a
// submit attempt, etc.). Keep this strictly read-only from a Question's
// perspective — the store remains the source of truth for answers.

import { createContext, useContext } from 'react'

export interface FormUiContextValue {
  numbering: Map<string, number>
  // linkIds of required+enabled items that are unanswered. Populated by
  // Form.handleSubmit once the user has clicked Submit at least once.
  invalidLinkIds: Set<string>
}

const FormUiContext = createContext<FormUiContextValue>({
  numbering: new Map(),
  invalidLinkIds: new Set(),
})

export const FormUiProvider = FormUiContext.Provider

export function useFormUi(): FormUiContextValue {
  return useContext(FormUiContext)
}
