import type { EducationalData } from "@/types/assignment"

export const initialData: EducationalData = {
  subjects: [{ subject: "Mathematics" }, { subject: "Science" }, { subject: "History" }],
  /*
  groups: [
    { group_id: "25-10-MA", subject: "Mathematics", join_code: "ABC12" },
    { group_id: "25-11-SC", subject: "Science", join_code: "DEF34" },
    { group_id: "25-10-HI", subject: "History", join_code: "GHI56" },
  ],
  */
  units: [
    { unit_id: "UNIT001", title: "Algebra Basics", subject: "Mathematics" },
    { unit_id: "UNIT002", title: "Introduction to Biology", subject: "Science" },
    { unit_id: "UNIT003", title: "World War II Overview", subject: "History" },
    { unit_id: "UNIT004", title: "Geometry Fundamentals", subject: "Mathematics" },
    { unit_id: "UNIT005", title: "Chemistry Basics", subject: "Science" },
    { unit_id: "UNIT006", title: "Physics Fundamentals", subject: "Science" },
    { unit_id: "UNIT007", title: "Ancient Civilizations", subject: "History" },
    { unit_id: "UNIT008", title: "Modern History", subject: "History" },
  ],
  assignments: [],
}
