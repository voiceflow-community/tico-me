import ElectronStore from 'electron-store'
const store = new ElectronStore()

// let isRecording = false
// let recordDuration = store.get('recordDuration', 30000) // Default to 30000 milliseconds (30 seconds)

function updateSettings() {
  settings.apiUrl = document.getElementById('apiUrl').value
  settings.apiToken = document.getElementById('apiToken').value
  settings.recordDuration =
    parseInt(document.getElementById('recordDuration').value) * 1000
  console.log('Settings updated:', settings)
}

function saveSettings() {
  const apiUrl = document.getElementById('apiUrl').value
  const apiToken = document.getElementById('apiToken').value
  const recordDuration =
    parseInt(document.getElementById('recordDuration').value) * 1000

  store.set('apiUrl', apiUrl)
  store.set('apiToken', apiToken)
  store.set('recordDuration', recordDuration)

  console.log('Settings saved:', { apiUrl, apiToken, recordDuration })
}

function loadSettings() {
  const apiUrl = store.get('apiUrl', '')
  const apiToken = store.get('apiToken', '')
  const recordDuration = store.get('recordDuration', 30000) / 1000 // Convert back to seconds for display

  document.getElementById('apiUrl').value = apiUrl
  document.getElementById('apiToken').value = apiToken
  document.getElementById('recordDuration').value = recordDuration

  console.log('Settings loaded:', { apiUrl, apiToken, recordDuration })
}

document.addEventListener('DOMContentLoaded', loadSettings)
document.getElementById('save').addEventListener('click', saveSettings) // Assume there's a save button in your HTML
