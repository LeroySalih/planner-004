export interface Subject {
  subject: string
}

export interface Group {
  group_id: string
  subject: string
  join_code: string
  active: boolean
}

export interface Unit {
  unit_id: string
  title: string
  subject: string
}

export interface Assignment {
  group_id: string
  unit_id: string
  start_date: string
  end_date: string
}

export interface EducationalData {
  subjects: Subject[]
  // groups: Group[]
  units: Unit[]
  assignments: Assignment[]
}

export type AssignmentChangeEvent = "create" | "edit" | "delete" | "unit-title-click"

