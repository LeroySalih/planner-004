import Image, { type ImageProps } from "next/image"

import { cn } from "@/lib/utils"

type MediaImageProps = Omit<ImageProps, "alt" | "src"> & {
  src: string
  alt: string
  /**
   * Forces a plain img tag, useful for blob/data URLs or when Next.js loaders cannot handle the source.
   */
  useImgFallback?: boolean
  /**
   * Optional alternative text used when falling back to img.
   */
  fallbackAlt?: string
}

const dataLikePrefixes = ["data:", "blob:"]
const apiLikePrefixes = ["/api/files", "/files/"]

export function MediaImage({
  src,
  alt,
  className,
  useImgFallback = false,
  fallbackAlt,
  ...rest
}: MediaImageProps) {
  const shouldFallback =
    useImgFallback ||
    dataLikePrefixes.some((prefix) => src.startsWith(prefix)) ||
    apiLikePrefixes.some((prefix) => src.startsWith(prefix))

  if (shouldFallback) {
    return (
      <img
        src={src}
        alt={fallbackAlt ?? alt}
        className={cn("object-cover", className)}
        loading={rest.loading}
      />
    )
  }

  return <Image src={src} alt={alt} className={className} {...rest} />
}
