import type { FormItem } from '../types/form'
import { useFormStore } from '../store/form_store'
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

  if (!enabled) return null

  const isGroup = item.type === 'grid' || item.type === 'repeating_group'

  return (
    <div className="flex flex-col gap-3">
      <p className={`text-sm font-medium text-gray-900 ${isGroup ? 'text-base' : ''}`}>
        {item.text}
        {item.required && <span className="ml-1 text-red-500" aria-hidden>*</span>}
      </p>
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
  }
}
