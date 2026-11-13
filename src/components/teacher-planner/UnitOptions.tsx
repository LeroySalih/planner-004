import type { Unit } from '@/types'

type UnitOptionsProps = {
  units: Unit[]
  /** Units in the class's scheme of work for this half-term; undefined outside one. */
  sowUnitIds?: Set<string>
}

/**
 * A unit dropdown's options. Scheme-of-work units come first, in their own
 * labelled section: with 40-odd units in a subject, the two or three actually
 * planned for this half-term are otherwise buried alphabetically. The rest stay
 * selectable — a teacher covering a colleague, or deviating from the plan, must
 * not be blocked by it.
 */
export function UnitOptions({ units, sowUnitIds }: UnitOptionsProps) {
  const schemeUnits = sowUnitIds ? units.filter((u) => sowUnitIds.has(u.unit_id)) : []
  if (schemeUnits.length === 0) {
    return units.map((u) => (
      <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
    ))
  }
  const otherUnits = units.filter((u) => !sowUnitIds!.has(u.unit_id))
  return (
    <>
      <optgroup label="This half-term's plan">
        {schemeUnits.map((u) => (
          <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
        ))}
      </optgroup>
      <optgroup label="Other units">
        {otherUnits.map((u) => (
          <option key={u.unit_id} value={u.unit_id}>{u.title}</option>
        ))}
      </optgroup>
    </>
  )
}
