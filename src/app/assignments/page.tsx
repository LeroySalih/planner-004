import AssignmentManager  from "@/components/assignment-manager"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
import { getGroups } from "@/actions/groups/get-groups"

export default async function Home() {

  const {data:groups, error: groupsError} = await getGroups();

  if (groupsError)  {
    return <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Error Loading Groups</h1>
      <p className="text-red-600">There was an error loading the groups: {groupsError}</p>
    </div>
  }


  return (
    <main className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Assignment Manager</h1>
        <Link href="/units">
          <Button variant="outline">
            <BookOpen className="h-4 w-4 mr-2" />
            View All Units
          </Button>
        </Link>
      </div>
      <AssignmentManager groups={groups}/>
    </main>
  )
}
