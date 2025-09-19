import type { Assignments, Subjects, Units } from "@/types"

export const sampleSubjects: Subjects = [
  { subject: "Mathematics", active: true },
  { subject: "Science", active: true },
  { subject: "History", active: true },
]

export const sampleUnits: Units = [
  { unit_id: "UNIT001", title: "Algebra Basics", subject: "Mathematics", active: true },
  { unit_id: "UNIT002", title: "Introduction to Biology", subject: "Science", active: true },
  { unit_id: "UNIT003", title: "World War II Overview", subject: "History", active: true },
  { unit_id: "UNIT004", title: "Geometry Fundamentals", subject: "Mathematics", active: true },
  { unit_id: "UNIT005", title: "Chemistry Basics", subject: "Science", active: true },
  { unit_id: "UNIT006", title: "Physics Fundamentals", subject: "Science", active: true },
  { unit_id: "UNIT007", title: "Ancient Civilizations", subject: "History", active: true },
  { unit_id: "UNIT008", title: "Modern History", subject: "History", active: true },
]

export const sampleAssignments: Assignments = []
