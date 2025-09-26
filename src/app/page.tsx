import Image from "next/image"

const Home = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Image src="/header.png" alt="Planner" width={480} height={160} priority />
    </div>
  )
}

export default Home
