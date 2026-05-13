import type { FormItem } from '../../types/form'
import { useFormStore, groupChildKey } from '../../store/form_store'
import { Question } from '../Question'

interface Props {
  item: FormItem
}

// Renders N instances of a set of child questions.
// Child answers are stored under keys: `{parentLinkId}[{i}]:{childLinkId}`
export function RepeatingGroup({ item }: Props) {
  const groupInstances = useFormStore(s => s.groupInstances)
  const addInstance = useFormStore(s => s.addInstance)
  const removeInstance = useFormStore(s => s.removeInstance)

  const count = groupInstances.get(item.linkId) ?? 1
  const children = item.children ?? []

  // Derive the group label from the parent question text (e.g., "Medication" → "Add another medication")
  const entityLabel = item.text.replace(/^(please\s+)?(list|describe|enter|provide)\s+/i, '').toLowerCase()

  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {count > 1 ? `${item.text} — ${i + 1} of ${count}` : item.text}
            </span>
            {count > 1 && (
              <button
                type="button"
                onClick={() => removeInstance(item.linkId, i)}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <div className="flex flex-col gap-4">
            {children.map(child => (
              <InstanceChild
                key={child.linkId}
                parent={item}
                child={child}
                instanceIndex={i}
              />
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => addInstance(item.linkId)}
        className="self-start rounded-lg border border-dashed border-gray-400 px-4 py-2 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        + Add another {entityLabel}
      </button>
    </div>
  )
}

// A child item scoped to a specific instance. Proxies the store through the
// keyed linkId by rewriting `child.linkId` (and grid row linkIds) to the
// `parent[i]:child` form. The serializer applies the inverse rewrite via
// InstanceContext, so the stored shape and the emitted FHIR shape stay in sync.
function InstanceChild({
  parent,
  child,
  instanceIndex,
}: {
  parent: FormItem
  child: FormItem
  instanceIndex: number
}) {
  const key = groupChildKey(parent.linkId, instanceIndex, child.linkId)
  const proxiedItem: FormItem = { ...child, linkId: key }
  if (child.type === 'grid' && child.gridConfig) {
    proxiedItem.gridConfig = {
      ...child.gridConfig,
      rows: child.gridConfig.rows.map(row => ({
        ...row,
        linkId: groupChildKey(parent.linkId, instanceIndex, row.linkId),
      })),
    }
  }
  return <Question item={proxiedItem} />
}
