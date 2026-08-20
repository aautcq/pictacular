export interface Alert {
  id: string
  type: 'success' | 'error'
  message: string
}

export const ALERT_DURATION_MS = 5_000

// App-wide alert/toast queue (issue #48): a reusable seam for later
// features to surface success/error messages, auto-dismissed after
// ALERT_DURATION_MS. Backed by useState so it's shared across every
// component/page without a state-management library.
export function useAlerts() {
  const alerts = useState<Alert[]>('alerts', () => [])

  function addAlert(type: Alert['type'], message: string) {
    const id = crypto.randomUUID()
    alerts.value = [...alerts.value, { id, type, message }]

    if (import.meta.client) {
      setTimeout(removeAlert, ALERT_DURATION_MS, id)
    }
  }

  function removeAlert(id: string) {
    alerts.value = alerts.value.filter(alert => alert.id !== id)
  }

  function addSuccess(message: string) {
    addAlert('success', message)
  }

  function addError(message: string) {
    addAlert('error', message)
  }

  return { alerts, addAlert, addSuccess, addError, removeAlert }
}
