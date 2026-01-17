import { getRevisionSettings, saveRevisionSettings } from "@/actions/settings"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { revalidatePath } from "next/cache"

export default async function SettingsPage() {
  const settings = await getRevisionSettings()

  async function updateSettings(formData: FormData) {
    "use server"
    const newSettings = {
      shortText: formData.get("shortText") === "on",
      multipleChoice: formData.get("multipleChoice") === "on",
      singleChoice: formData.get("singleChoice") === "on",
      uploadFile: formData.get("uploadFile") === "on",
      uploadLink: formData.get("uploadLink") === "on",
    }
    await saveRevisionSettings(newSettings)
    revalidatePath("/admin/settings")
  }

  return (
    <div className="container mx-auto py-10">
      <Card>
        <CardHeader>
          <CardTitle>Revision Settings</CardTitle>
          <CardDescription>Configure which activity types are included in revisions.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateSettings} className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox id="shortText" name="shortText" defaultChecked={settings.shortText} />
                <Label htmlFor="shortText">Short Text</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="multipleChoice" name="multipleChoice" defaultChecked={settings.multipleChoice} />
                <Label htmlFor="multipleChoice">Multiple Choice</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="singleChoice" name="singleChoice" defaultChecked={settings.singleChoice} />
                <Label htmlFor="singleChoice">Single Choice</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="uploadFile" name="uploadFile" defaultChecked={settings.uploadFile} />
                <Label htmlFor="uploadFile">Upload File</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="uploadLink" name="uploadLink" defaultChecked={settings.uploadLink} />
                <Label htmlFor="uploadLink">Upload Link</Label>
              </div>
            </div>
            <Button type="submit">Save Changes</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
