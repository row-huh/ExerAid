// responsible for uploading the reference files to buckets so that the patient can access them when performing exercises


import { supabase } from "@/utils/supabase/client"

const SUPABASE_BUCKET = "reference-videos"

export interface UploadResult {
  videoUrl: string
  videoPath: string
}


export async function uploadVideoToStorage(
  name: string,
  videoBlob: Blob,
  exerciseType: string
): Promise<UploadResult> {
  const id = Date.now().toString()
  const fileName = `${id}_${name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.webm`
  const filePath = `${exerciseType}/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(filePath, videoBlob, {
      contentType: videoBlob.type || "video/webm",
      cacheControl: "3600",
      upsert: false,
    })

  if (uploadError) {
    throw new Error(`Failed to upload video: ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(filePath)

  if (!urlData?.publicUrl) {
    throw new Error("Failed to get public URL for uploaded video")
  }


  
  return { videoUrl: urlData.publicUrl, videoPath: filePath }
}

