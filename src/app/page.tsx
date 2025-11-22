import Image from "next/image"

const Home = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-8">
      <Image
        src="/header.png"
        alt="Planner"
        width={480}
        height={160}
        priority
        className="h-auto w-full max-w-[420px] sm:max-w-[480px]"
      />
    </div>
  )
}

export default Home
