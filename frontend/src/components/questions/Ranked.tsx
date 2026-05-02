import type { FormItem, AnswerValue } from '../../types/form'
import { useFormStore } from '../../store/form_store'

const EMPTY: AnswerValue[] = []

interface Props {
  item: FormItem
}

export function Ranked({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? EMPTY)
  const setAnswer = useFormStore(s => s.setAnswer)

  const options = item.options ?? []

  const codeToRank = new Map<string, number>()
  answers.forEach((a, idx) => {
    if (a.type === 'coding' && a.coding.code) {
      codeToRank.set(a.coding.code, idx + 1)
    }
  })

  function handleRankChange(code: string, rank: number | null) {
    const next = new Map(codeToRank)
    if (rank === null) {
      next.delete(code)
    } else {
      for (const [c, r] of next) {
        if (r === rank && c !== code) next.delete(c)
      }
      next.set(code, rank)
    }
    const sorted = [...next.entries()]
      .sort(([, a], [, b]) => a - b)
      .map(([c]) => {
        const opt = options.find(o => o.code === c)!
        return { type: 'coding' as const, coding: { code: c, display: opt.display, system: opt.system } }
      })
    setAnswer(item.linkId, sorted)
  }

  const rankOptions = options.map((_, i) => i + 1)
  const assignedRanks = new Set(codeToRank.values())

  return (
    <div className="flex flex-col gap-2">
      {options.map(opt => {
        const rank = codeToRank.get(opt.code) ?? null
        return (
          <div key={opt.code} className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 bg-white">
            <select
              value={rank ?? ''}
              onChange={e => handleRankChange(opt.code, e.target.value ? Number(e.target.value) : null)}
              className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="">—</option>
              {rankOptions.map(n => (
                <option
                  key={n}
                  value={n}
                  disabled={assignedRanks.has(n) && rank !== n}
                >
                  {n}
                </option>
              ))}
            </select>
            <span className={`text-sm ${rank !== null ? 'font-medium text-gray-900' : 'text-gray-500'}`}>
              {opt.display}
            </span>
          </div>
        )
      })}
      <p className="text-xs text-gray-400 mt-1">
        Assign a rank to each option. Rank 1 is most important.
      </p>
    </div>
  )
}
