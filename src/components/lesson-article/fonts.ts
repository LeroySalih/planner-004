import { Inter, Source_Serif_4 } from "next/font/google"

// Type for the pupil lesson article: a serif for headings and intro text,
// Inter for everything else. Exposed as CSS variables read by the `la-`
// font tokens in globals.css.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
})

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

export const lessonArticleFontClass = `${sourceSerif.variable} ${inter.variable}`
