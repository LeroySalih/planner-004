import { Bricolage_Grotesque, Hanken_Grotesk, Space_Grotesk } from "next/font/google"

// Type families for the "Warm Study" pupil activity design.
// Each exposes a CSS variable consumed by the `--font-pa-*` theme tokens
// (see globals.css). Apply `pupilActivityFontClass` to any subtree that
// renders a PupilActivityCard so the variables resolve.
export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
})

export const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
})

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
})

export const pupilActivityFontClass = `${bricolage.variable} ${hanken.variable} ${spaceGrotesk.variable}`
