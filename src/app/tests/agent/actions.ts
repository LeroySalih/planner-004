"use server"

interface AiMarkingResponse {
  success: boolean
  data?: any
  error?: string
  debug?: any
}

export async function invokeAiMarking(params: {
  question: string
  model_answer: string
  pupil_answer: string
}): Promise<AiMarkingResponse> {
  const url = "https://faas-tor1-70ca848e.doserverless.co/api/v1/namespaces/fn-08d42cfc-a8ba-4642-bf39-feb2c2eeb514/actions/ai-marking/short-text?blocking=true&result=true"
  const auth = "Basic NzMxMzQ0YzctZWUyOC00NzFhLWEwOGQtZDczY2YzN2QxNGEzOlJ5bEVObFRsaEdBZHRPQ0pZWjlhTzdWeGw3NG1EMFcyRU5nNG1rVUJ4WlBPSFhYNGxYT0JVNFNWRnhuRG53VEE="

  const debugInfo: any = {
    url,
    input: params,
  }

  try {
    console.log("[AI Marking] Invoking FaaS:", url)

    const startTime = Date.now()
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": auth
      },
      body: JSON.stringify(params),
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