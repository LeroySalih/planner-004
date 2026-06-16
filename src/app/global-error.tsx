"use client"

import { useEffect } from "react"

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("[global-error]", { message: error?.message, digest: error?.digest })
    // Redirect to signin after a short delay so the loading UI is visible
    const timer = setTimeout(() => {
      window.location.href = "/signin"
    }, 1500)
    return () => clearTimeout(timer)
  }, [error])

  return (
    <html>
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            fontFamily: "system-ui, sans-serif",
            background: "#fff",
            color: "#111",
            gap: "16px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "3px solid #e5e7eb",
              borderTopColor: "#6366f1",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <p style={{ fontSize: "15px", color: "#6b7280", margin: 0 }}>Loading…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </body>
    </html>
  )
}
