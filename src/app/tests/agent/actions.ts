"use server"

interface AgentResponse {
  success: boolean
  data?: any
  error?: string
  debug?: any
}

export async function invokeDigitalOceanAgent(input: string): Promise<AgentResponse> {
  const endpoint = process.env.DIGITAL_OCEAN_ENDPOINT
  const accessKey = process.env.DIGITAL_OCEAN_ACCESS_KEY

  const debugInfo = {
    endpointConfigured: !!endpoint,
    accessKeyConfigured: !!accessKey,
    inputLength: input.length,
  }

  if (!endpoint || !accessKey) {
    return {
      success: false,
      error: "Missing Configuration: DIGITAL_OCEAN_ENDPOINT or DIGITAL_OCEAN_ACCESS_KEY is not set.",
      debug: debugInfo
    }
  }

  try {
    // Digital Ocean GenAI Agent invocation expects:
    // POST <base_url>/api/v1/chat/completions
    // Header: Authorization: Bearer <key>
    // Body: { "messages": [{ "role": "user", "content": "..." }] }
    
    let targetUrl = endpoint.trim()
    // Remove potential trailing slash
    targetUrl = targetUrl.replace(/\/$/, "")
    
    // Check if the endpoint already has the full path or just the base URL
    if (!targetUrl.endsWith("/api/v1/chat/completions")) {
       // If it ends with /api/v1/chat (previous attempt), replace it
       if (targetUrl.endsWith("/api/v1/chat")) {
           targetUrl = targetUrl.replace(/\/api\/v1\/chat$/, "/api/v1/chat/completions")
       } else {
           // Otherwise append the full path
           targetUrl = targetUrl + "/api/v1/chat/completions"
       }
    }
    
    console.log("[DigitalOcean Agent] Invoking:", targetUrl)

    const startTime = Date.now()
    
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessKey}`
      },
      body: JSON.stringify({
        messages: [
            {
                role: "user",
                content: input
            }
        ]
      }),
      signal: AbortSignal.timeout(30000) 
    })

    const duration = Date.now() - startTime
    
    const responseText = await response.text()
    let responseData
    try {
        responseData = JSON.parse(responseText)
    } catch {
        responseData = responseText
    }

    if (!response.ok) {
      return {
        success: false,
        error: `API Error: ${response.status} ${response.statusText}`,
        debug: {
          ...debugInfo,
          targetUrl,
          duration: `${duration}ms`,
          status: response.status,
          responseBody: responseData
        }
      }
    }

    return {
      success: true,
      data: responseData,
      debug: {
        ...debugInfo,
        targetUrl,
        duration: `${duration}ms`,
        status: response.status,
      }
    }

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      debug: {
        ...debugInfo,
        rawError: String(error)
      }
    }
  }
}
