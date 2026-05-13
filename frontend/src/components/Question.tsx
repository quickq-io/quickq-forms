import type { FormItem } from '../types/form'
import { useFormStore } from '../store/form_store'
import { useFormUi } from './form_context'
import { Boolean } from './questions/Boolean'
import { Text } from './questions/Text'
import { SingleChoice } from './questions/SingleChoice'
import { MultipleChoice } from './questions/MultipleChoice'
import { SataOther } from './questions/SataOther'
import { Numeric } from './questions/Numeric'
import { DateQuestion } from './questions/DateQuestion'
import { Likert } from './questions/Likert'
import { Slider } from './questions/Slider'
import { Grid } from './questions/Grid'
import { Ranked } from './questions/Ranked'
import { RepeatingGroup } from './questions/RepeatingGroup'

interface Props {
  item: FormItem
}

export function Question({ item }: Props) {
  const enabled = useFormStore(s => s.enabled.get(item.linkId) ?? true)
  const ui = useFormUi()

  if (!enabled) return null

  if (item.type === 'instruction') {
    return (
      <p data-link-id={item.linkId} className="text-sm text-gray-600 leading-relaxed">
        {item.text}
      </p>
    )
  }

  if (item.type === 'section') {
    return (
      <section data-link-id={item.linkId} className="flex flex-col gap-6">
        {item.text && (
          <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">
            {item.text}
          </h2>
        )}
        {(item.children ?? []).map(child => (
          <Question key={child.linkId} item={child} />
        ))}
      </section>
    )
  }

  const isGroup = item.type === 'grid' || item.type === 'repeating_group'
  // Numbering map keys on the *model* linkId. RepeatingGroup renders its
  // children with a synthetic instance-keyed linkId (`parent[i]:child`), so
  // those children correctly miss the map and remain un-numbered.
  const number = ui.numbering.get(item.linkId)
  const isInvalid = ui.invalidLinkIds.has(item.linkId)

  return (
    <div
      data-link-id={item.linkId}
      className={`flex flex-col gap-2 ${
        isInvalid ? 'rounded-lg border border-red-300 bg-red-50/40 p-3 -m-3' : ''
      }`}
    >
      <p className={`text-sm font-medium text-gray-900 ${isGroup ? 'text-base' : ''}`}>
        {number !== undefined && (
          <span className="text-gray-400 font-normal mr-2">{number}.</span>
        )}
        {item.text}
        {item.required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
      </p>
      {isInvalid && (
        <p className="text-xs text-red-700" role="alert">
          This question is required.
        </p>
      )}
      <QuestionInput item={item} />
    </div>
  )
}

function QuestionInput({ item }: Props) {
  switch (item.type) {
    case 'boolean':
      return <Boolean item={item} />
    case 'text':
      return <Text item={item} />
    case 'single_choice':
      return <SingleChoice item={item} />
    case 'multiple_choice':
      return <MultipleChoice item={item} />
    case 'sata_other':
      return <SataOther item={item} />
    case 'numeric':
      return <Numeric item={item} />
    case 'date':
    case 'datetime':
      return <DateQuestion item={item} />
    case 'likert':
      return <Likert item={item} />
    case 'slider':
      return <Slider item={item} />
    case 'grid':
      return <Grid item={item} />
    case 'ranked':
      return <Ranked item={item} />
    case 'repeating_group':
      return <RepeatingGroup item={item} />
    case 'section':
    case 'instruction':
      // handled in the outer Question component before reaching the dispatcher
      return null
  }
}
