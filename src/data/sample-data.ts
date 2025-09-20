import type { Assignments, Subjects, Units } from "@/types"

export const sampleSubjects: Subjects = [
  { subject: "Mathematics", active: true },
  { subject: "Science", active: true },
  { subject: "History", active: true },
]

export const sampleUnits: Units = [
  {
    unit_id: "UNIT001",
    title: "Algebra Basics",
    subject: "Mathematics",
    description:
      "Establishes a foundation in algebraic thinking with linear equations, inequalities, and graphing so learners can progress to advanced problem solving with confidence.",
    active: true,
  },
  {
    unit_id: "UNIT002",
    title: "Introduction to Biology",
    subject: "Science",
    description:
      "Explores the structure and function of living organisms, covering cell biology, genetics, and ecosystems through lab investigations and collaborative projects.",
    active: true,
  },
  {
    unit_id: "UNIT003",
    title: "World War II Overview",
    subject: "History",
    description:
      "Analyzes the global conflict from multiple perspectives while emphasizing political alliances, key battles, and the lasting social impact on modern societies.",
    active: true,
  },
  {
    unit_id: "UNIT004",
    title: "Geometry Fundamentals",
    subject: "Mathematics",
    description:
      "Introduces geometric reasoning with a focus on planar figures, transformations, and proofs that reinforce spatial awareness and logical thinking.",
    active: true,
  },
  {
    unit_id: "UNIT005",
    title: "Chemistry Basics",
    subject: "Science",
    description:
      "Builds conceptual understanding of matter, chemical reactions, and the periodic table using guided experiments and real-world examples.",
    active: true,
  },
  {
    unit_id: "UNIT006",
    title: "Physics Fundamentals",
    subject: "Science",
    description:
      "Covers the core principles of motion, forces, and energy with hands-on demonstrations that connect theory to everyday phenomena.",
    active: true,
  },
  {
    unit_id: "UNIT007",
    title: "Ancient Civilizations",
    subject: "History",
    description:
      "Investigates the development of early societies across Mesopotamia, Egypt, and the Indus Valley, highlighting culture, governance, and innovation.",
    active: true,
  },
  {
    unit_id: "UNIT008",
    title: "Modern History",
    subject: "History",
    description:
      "Examines pivotal events from the 20th and 21st centuries, encouraging critical analysis of primary sources and historical narratives.",
    active: true,
  },
]

export const sampleAssignments: Assignments = []
