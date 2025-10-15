## Sidebar UI Update Plan

1. Review the existing assignment results sidebar component to identify where current score, question details, success criteria inputs, and layout padding are defined.
2. Modify the component so the current score percentage display remains intact while removing any redundant text labels that duplicate the score.
3. Ensure the question prompt, correct answer, and pupil answer blocks remain rendered without structural changes.
4. Replace the numeric success-criteria input with a segmented control of three buttons (`0`, `Partial`, `Full`) that update the stored score values to `0`, `0.5`, and `1` respectively.
5. Introduce sidebar padding (confirm design token or Tailwind utility to use) to provide consistent spacing around the content.
6. Validate the revised interaction by exercising a sample assignment result, confirming button selections update scores correctly and the layout matches expectations.
