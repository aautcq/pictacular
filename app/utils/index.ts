export async function downloadFile(url: string, filename: string) {
  const blob = await fetch(url).then(response => response.blob())
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
