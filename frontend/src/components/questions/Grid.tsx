import type { FormItem } from '../../types/form'
import { useFormStore } from '../../store/form_store'

interface Props {
  item: FormItem
}

export function Grid({ item }: Props) {
  const answers = useFormStore(s => s.answers)
  const setAnswer = useFormStore(s => s.setAnswer)
  const clearAnswer = useFormStore(s => s.clearAnswer)

  const cfg = item.gridConfig!

  function getSelected(rowLinkId: string): string | null {
    const a = answers.get(rowLinkId) ?? []
    return a[0]?.type === 'coding' ? a[0].coding.code ?? null : null
  }

  function handleSelect(rowLinkId: string, colCode: string) {
    const current = getSelected(rowLinkId)
    if (current === colCode) {
      clearAnswer(rowLinkId)
    } else {
      const col = cfg.columns.find(c => c.code === colCode)
      setAnswer(rowLinkId, [
        { type: 'coding', coding: { code: colCode, display: col?.display, system: col?.system } },
      ])
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 text-gray-500 font-medium border-b border-gray-200 w-40" />
            {cfg.columns.map(col => (
              <th
                key={col.code}
                className="text-center px-3 py-2 text-gray-700 font-medium border-b border-gray-200 min-w-[80px]"
              >
                {col.display}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cfg.rows.map((row, rowIdx) => {
            const selected = getSelected(row.linkId)
            return (
              <tr
                key={row.linkId}
                className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <td className="px-3 py-3 text-gray-700 border-b border-gray-100">{row.text}</td>
                {cfg.columns.map(col => {
                  const checked = selected === col.code
                  return (
                    <td key={col.code} className="px-3 py-3 text-center border-b border-gray-100">
                      <label className="inline-flex items-center justify-center cursor-pointer">
                        <input
                          type="radio"
                          className="sr-only"
                          name={row.linkId}
                          checked={checked}
                          onChange={() => handleSelect(row.linkId, col.code)}
                        />
                        <span
                          className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                            checked ? 'border-blue-600' : 'border-gray-400'
                          }`}
                        >
                          {checked && <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />}
                        </span>
                        <span className="sr-only">{col.display}</span>
                      </label>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
