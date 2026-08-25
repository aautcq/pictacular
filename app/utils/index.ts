import type { Photo } from '~/composables/usePhotoLibrary'

export async function downloadFile(url: string, filename: string) {
  const blob = await fetch(url).then(response => response.blob())
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

export function getPhotoFileName(photo: Photo) {
  return photo.url.split('/').pop()?.split('?')[0] ?? `photo-${photo.id}`
}
