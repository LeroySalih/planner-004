# Short Text Question Types Specification

## Change Log

2026-02-15  Initial specification for Name, List, and Explain question types.

## Overview

Short text questions (`short-text-question`) support three question types that determine how a pupil's answer is evaluated against the model answer. All three types produce a floating-point score between 0 and 1, where 0 is totally incorrect and 1 is totally correct.

The question type is inferred from the question text prefix:

| Prefix | Type | Expected answer |
|---|---|---|
| `Name` | Name | A single word or short phrase |
| `List` | List | Multiple items |
| Anything else (e.g. `Explain`, `Describe`) | Explain | At least two clauses: a fact and an application |

## Question Type: Name

### Description

A Name question expects a **single word or short phrase** as the answer. The pupil's answer is judged on whether it is equivalent to the model answer.

### Detection

The question text starts with the word "Name" (case-insensitive).

### Scoring

| Condition | Score |
|---|---|
| Answer is equivalent to the model answer | 1.0 |
| Answer is not equivalent | 0.0 |

Equivalence allows for minor spelling variations, synonyms, and acceptable alternative forms (e.g. "CPU" and "Central Processing Unit" are equivalent if the model answer accepts both).

### Example

**Question:** "Name the process by which plants make food."
**Model answer:** "Photosynthesis"
**Pupil answer:** "photosynthesis" -> Score: 1.0
**Pupil answer:** "respiration" -> Score: 0.0

---

## Question Type: List

### Description

A List question expects **multiple items**. The order in which the pupil provides the items is not important. The score is based on the proportion of model answer items that the pupil has correctly matched.

### Detection

The question text starts with the word "List" (case-insensitive).

### Scoring

```
score = number_of_matched_items / total_items_in_model_answer
```

Each model answer item can only be matched once. Duplicate pupil answers do not earn additional credit.

| Example | Score |
|---|---|
| 3 of 3 items matched | 1.0 |
| 2 of 3 items matched | 0.67 |
| 1 of 3 items matched | 0.33 |
| 0 of 3 items matched | 0.0 |

### Example

**Question:** "List three input devices."
**Model answer:** "Keyboard, Mouse, Microphone"
**Pupil answer:** "Mouse, Keyboard, Scanner" -> Score: 0.67 (2 of 3 matched)
**Pupil answer:** "Keyboard, Microphone, Mouse" -> Score: 1.0 (3 of 3, order irrelevant)

---

## Question Type: Explain

### Description

An Explain question requires the pupil to demonstrate understanding by providing **at least two clauses**: a **fact** and an **application** (explanation) that shows understanding of the fact. This is the default question type for any question that does not start with "Name" or "List".

### Detection

The question text does not start with "Name" or "List". Typically starts with "Explain", "Describe", "Why", or similar.

### Scoring

An Explain answer is scored on two components:

| Component | Weight | Description |
|---|---|---|
| Fact | 0.5 | A factual statement that matches the fact in the model answer |
| Application | 0.5 | An explanation that demonstrates understanding by applying the fact |

| Condition | Score |
|---|---|
| Correct fact + correct application | 1.0 |
| Correct fact + incorrect/missing application | 0.5 |
| Incorrect fact + any application | 0.0 |

The application must logically follow from the stated fact. A correct fact with an unrelated or incorrect application scores 0.5 only.

### Multiple Model Answer Options

A model answer may contain **multiple acceptable answer options**, separated by "or" or listed as alternatives. Each option is a complete fact + application pair.

**Rules:**
- The pupil must match **one complete option** (both the fact and application from the same option).
- Mixing the fact from one option with the application from another is **not acceptable** and scores only 0.5 (for the correct fact).
- Either option on its own is fully acceptable for a score of 1.0.

### Examples

**Question:** "Explain why copper is used in electrical cables."

**Model answer:** "Copper is used in electrical cables as it is a highly ductile metal [fact], and can therefore be easily formed into long thin cables [application]" **or** "Copper is highly conductive [fact], and will therefore carry electricity efficiently [application]."

| Pupil answer | Score | Reason |
|---|---|---|
| "Copper is ductile, so it can be shaped into long thin wires." | 1.0 | Fact and application match option 1 |
| "Copper is conductive, so it carries electricity well." | 1.0 | Fact and application match option 2 |
| "Copper is conductive, and can therefore be easily shaped into cables." | 0.5 | Fact from option 2, application from option 1 — mixed |
| "Copper is shiny." | 0.0 | Incorrect fact |
| "Copper is ductile." | 0.5 | Correct fact, missing application |

---

## Model Answer Format

### Name

A single word or short phrase.

```
Photosynthesis
```

### List

Items separated by commas or newlines.

```
Keyboard, Mouse, Microphone
```

### Explain

One or more complete fact + application pairs. Multiple options separated by `or`.

```
Copper is ductile [fact], and can be formed into long thin cables [application]
```

```
Copper is ductile [fact], and can be formed into long thin cables [application] or Copper is conductive [fact], and carries electricity efficiently [application]
```

The `[fact]` and `[application]` annotations are optional in the model answer but recommended for clarity when setting up activities. The AI marker should be able to identify fact and application clauses regardless of whether annotations are present.

---

## Integration with AI Marking

The question type should be communicated to the AI marking service so it can apply the correct evaluation strategy. The AI marking prompt should be adapted per type:

- **Name**: Evaluate whether the pupil answer is equivalent to the model answer. Return 0 or 1.
- **List**: Identify which items in the model answer the pupil has matched. Return matched_count / total_count.
- **Explain**: Identify the fact and application in the pupil answer. Check they belong to the same model answer option. Score 0.5 per correct component.

The `body_data` schema for `short-text-question` does not change. The question type is derived from the question text at marking time.
