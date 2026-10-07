export interface UploadItem {
  id: string
  name: string
  progress: number
  error: string | null
}

// `key` scopes the underlying `useState` (same rationale as useSearch/
// usePhotoGallery) so the home page's upload queue and an Album's own
// upload queue — two unrelated pages, each itself split into a page +
// `*@header.vue` named-view pair sharing one `usePhotoUpload` call —
// don't bleed into one another. `onUploaded` is what each page does with
// a File once it's finished uploading (e.g. usePhotoLibrary#addUploadedPhoto
// vs useAlbumPhotos#prependPhoto) — `handleFiles` below is the identical
// drag-drop/file-picker handling every page needs, kept here once rather
// than copy-pasted into both halves of each page's split.
export function usePhotoUpload(key: string, onUploaded: (photo: Photo) => void) {
  const { translateError } = useErrorMessage()

  const uploads = useState<UploadItem[]>(`${key}-uploads`, () => [])

  // Uploads a File to the User's own bucket via base64-in-JSON (matching
  // the avatar-upload contract), reporting 0-100 progress via a plain
  // `XMLHttpRequest` — `$fetch` has no upload-progress event to hook into.
  function uploadPhoto(file: File, onProgress?: (percent: number) => void) {
    return new Promise<Photo>((resolve, reject) => {
      const reader = new FileReader()

      reader.onerror = () => reject(reader.error ?? new Error('file_read_failed'))
      reader.onloadend = () => {
        const base64 = (reader.result as string).replace(/^data:.+;base64,/, '')
        const xhr = new XMLHttpRequest()

        xhr.open('POST', '/api/photos')
        xhr.setRequestHeader('Content-Type', 'application/json')

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable)
            onProgress?.(Math.round((event.loaded / event.total) * 100))
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const photo = JSON.parse(xhr.responseText) as Photo
            resolve(photo)
          }
          else {
            let statusMessage = 'photos.upload_failed'
            try {
              statusMessage = JSON.parse(xhr.responseText)?.statusMessage ?? statusMessage
            }
            catch {
              // Non-JSON error body — fall back to the generic message.
            }
            reject(createError({ statusCode: xhr.status, statusMessage }))
          }
        })

        xhr.addEventListener('error', () => reject(createError({ statusCode: 0, statusMessage: 'photos.upload_failed' })))

        xhr.send(JSON.stringify({
          filename: file.name,
          mime_type: file.type,
          base64,
          last_modified: new Date(file.lastModified).toISOString(),
        }))
      }

      reader.readAsDataURL(file)
    })
  }

  async function queueUpload(file: File) {
    const id = crypto.randomUUID()
    uploads.value = [...uploads.value, { id, name: file.name, progress: 0, error: null }]

    try {
      const photo = await uploadPhoto(file, (percent) => {
        uploads.value = uploads.value.map(item => item.id === id ? { ...item, progress: percent } : item)
      })
      uploads.value = uploads.value.filter(item => item.id !== id)
      return photo
    }
    catch (error) {
      uploads.value = uploads.value.map(item => item.id === id ? { ...item, error: translateError(error) } : item)
    }
  }

  // Shared drag-drop/file-picker handling (issue #215): filters to actual
  // images and uploads them one at a time (preserving drop order), handing
  // each finished Photo to the page's own `onUploaded` as it completes.
  async function handleFiles(fileList: FileList | null) {
    if (!fileList)
      return
    for (const file of Array.from(fileList)) {
      if (file.type.startsWith('image/')) {
        const photo = await queueUpload(file)
        if (photo)
          onUploaded(photo)
      }
    }
  }

  return {
    uploads,
    queueUpload,
    handleFiles,
  }
}
