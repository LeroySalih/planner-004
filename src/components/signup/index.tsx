"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabaseBrowserClient } from "@/lib/supabase-browser"
import { useRouter } from "next/navigation"

export function SignupForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setIsLoading(true)

    try {
      const { data, error: signUpError } = await supabaseBrowserClient.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        console.error("SignupForm: sign up error", signUpError)
        setError(signUpError.message)
        return
      }

      if (!data?.user) {
        setSuccessMessage("Check your email to confirm your account.")
        setEmail("")
        setPassword("")
        setConfirmPassword("")
        return
      }

      router.push("/profiles")
    } catch (submitError) {
      console.error("SignupForm: unexpected sign up error", submitError)
      setError(submitError instanceof Error ? submitError.message : "Unable to complete sign up.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-500">{successMessage}</p> : null}

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Signing up..." : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account? <Link href="/signin" className="text-primary underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </form>
  )
}
