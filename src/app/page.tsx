import { getGroups } from "@/actions/groups/get-groups";
import { getSubjects } from "@/actions/subjects/get-subjects";
import { getUnits } from "@/actions/units/get-units";
import { getAssignments } from "@/actions/assignments/get-assignments";

import Image from "next/image";

export default async function Home() {

  const {data: groups, error: groupsError} = await getGroups();
  const {data: subjects, error: subjectsError} = await getSubjects();
  const {data: units, error: unitsError} = await getUnits();
  const {data: assignments, error: assignmentsError} = await getAssignments();

  return (
    <div className="justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
      <pre>{JSON.stringify({subjects, groups, units, assignments}, null, 2)}</pre>

    </div>
  );
}
