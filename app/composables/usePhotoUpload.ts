export interface UploadItem {
  id: string
  name: string
  progress: number
  error: string | null
}

export function usePhotoUpload() {
  const { translateError } = useErrorMessage()

  const uploads = useState<UploadItem[]>('photo-uploads', () => [])

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

  return {
    uploads,
    queueUpload,
  }
}
