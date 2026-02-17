"use client"

import { useEffect, useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { issueSigninCsrfTokenAction, signinAction } from "@/lib/server-updates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type SigninState = {
  success: boolean
  error: string | null
  destination: string | null
}

function isValidReturnTo(url: string | undefined): url is string {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//")
}

export function SigninForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [csrfToken, setCsrfToken] = useState<string | null>(null)
  const [state, setState] = useState<SigninState>({ success: false, error: null, destination: null })
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    issueSigninCsrfTokenAction()
      .then(({ token }) => setCsrfToken(token))
      .catch(() => setState((prev) => ({ ...prev, error: "Unable to load sign-in form." })))
  }, [])

  useEffect(() => {
    if (!state.success || !state.destination) return

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: { status: "signed-in" } }))
    }

    router.replace(state.destination)
  }, [state, router])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!csrfToken) {
      setState((prev) => ({ ...prev, error: "Unable to sign you in right now." }))
      return
    }
    startTransition(async () => {
      const result = await signinAction({ email, password, csrfToken })

      const defaultDestination = result.isTeacher
        ? "/assignments"
        : result.userId
          ? `/pupil-lessons/${encodeURIComponent(result.userId)}`
          : "/pupil-lessons"

      const destination = result.success
        ? isValidReturnTo(returnTo) ? returnTo : defaultDestination
        : null

      setState({ success: result.success, error: result.error, destination })
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <Button type="submit" className="w-full" disabled={isPending || !csrfToken}>
        {isPending ? "Signing in..." : csrfToken ? "Sign in" : "Loading..."}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  )
}
