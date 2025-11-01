const textEncoder = new TextEncoder()

export function streamJsonResponse(payload: unknown) {
  const json = JSON.stringify(payload)

  const stream = new ReadableStream({
    start(controller) {
      const chunkLength = 1024
      for (let offset = 0; offset < json.length; offset += chunkLength) {
        const slice = json.slice(offset, offset + chunkLength)
        controller.enqueue(textEncoder.encode(slice))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
