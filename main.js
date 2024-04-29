import dotenv from 'dotenv'
dotenv.config()

import { app, BrowserWindow, Tray, Menu } from 'electron'
import record from 'node-record-lpcm16'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import FormData from 'form-data'
import ElectronStore from 'electron-store'
import PQueue from 'p-queue'

const queueRecording = new PQueue({ concurrency: 3 })
queueRecording.on('add', () => {
  console.log(
    `Task is added.  Size: ${queueRecording.size}  Pending: ${queueRecording.pending}`
  )
})

queueRecording.on('next', () => {
  console.log(
    `Task is completed.  Size: ${queueRecording.size}  Pending: ${queueRecording.pending}`
  )
})

const store = new ElectronStore()
let file
const __dirname = path.dirname(fileURLToPath(import.meta.url))
let tray = null
let settingsWindow = null
let isRecording = false
let forceStop = false
let recorder = null
let filePath = null
let timeoutId
// let recordDuration = store.get('recordDuration', 30000)

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    show: false, // Initially don't show the window
  })

  settingsWindow.loadFile('index.html')

  settingsWindow.on('ready-to-show', () => {
    // settingsWindow.show()
    const settingsExist =
      store.get('apiUrl') &&
      store.get('apiToken') &&
      store.get('recordDuration')
    if (settingsExist) {
      // settingsWindow.webContents.send('start-recording')
    }
  })

  settingsWindow.on('close', (event) => {
    event.preventDefault()
    settingsWindow.hide()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

function toggleRecording() {
  if (isRecording) {
    stopRecording()
  } else {
    startRecording()
  }
}

function startRecording() {
  forceStop = false
  if (isRecording) {
    console.log("Attempt to start recording, but it's already recording.")
    return
  }
  isRecording = true

  filePath = `audio-${Date.now()}.wav`
  file = fs.createWriteStream(filePath, { encoding: 'binary' })

  recorder = record.record({
    sampleRate: 16000,
    verbose: false,
    channels: 1,
    recorder: 'rec', // 'sox',
    endOnSilence: true,
    thresholdStart: 2.0,
    thresholdEnd: 1.8,
    silence: '2.0',
  })

  console.log('Recording started')

  recorder.stream().pipe(file)

  file.on('finish', async () => {
    // Handle silence detection and end of file here
    console.log('File saved:', filePath)
    queueRecording
      .add(() => sendFileToWhisper(filePath))
      .then((result) => {
        // console.log('File processed:', result)
        // console.log(queueRecording.size)
        isRecording = false
        recorder = null

        // Start a new recording if the app is still active
        if (!app.isQuitting && forceStop == false) {
          startRecording()
        }
      })
      .catch((error) => {
        // Handle the error
        console.error('Error processing file:', error)
      })
  })

  // Using VAD instead here
  // Stop recording after the specified duration
  /* timeoutId = setTimeout(() => {
    console.log('Timeout reached, stopping recording.')
    stopRecording(recorder, filePath)
    startRecording()
  }, recordDuration) */
}

function stopRecording(recorder, filePath) {
  if (!isRecording) {
    console.log("Attempt to stop recording, but it's not currently recording.")
    return
  }
  console.log('Stopping recording...')
  //clearTimeout(timeoutId)
  isRecording = false
  forceStop = true
  recorder.stop()

  /* file.on('finish', () => {
    recorder = null
    console.log('Recording saved, sending file to server.')
    sendFileToWhisper(filePath)
  }) */

  console.log('Recording stopped.')
}

async function sendFileToWhisper(filePath) {
  // console.log(filePath)
  const formData = new FormData()
  const filename = path.basename(filePath)

  formData.append('audio_file', fs.createReadStream(filePath), {
    filename: filename,
    contentType: 'audio/wav',
  })
  // console.log(store.get('apiUrl'))
  // Tests to correct words using Whisper prompt
  /*  const corrections = {
    voiceflow: [
      'voicflow',
      'voice flow',
      'voiselo',
      'voizeflo',
      'voiceflwo',
      'voiclo',
      'voicelo',
    ],
    'voiceflow.studio': [
      'voiselo.studio',
      'voicflwo.studio',
      'voiclo.studio',
      'voicelo.studio',
    ],
    Tico: ['tiko', 'teako', 'teeco', 'ticau'],
    NiKo: ['nico', 'niko', 'nicoo', 'nicau'],
  }

  let initial_prompt = `Generate a transcript from the given audio by following these rules:
  - Translate it to English if needed.
  - Use the following CORRECT_WORDS to help you find incorrect variants (you can use similarity) and replace them with the correct term:
  #CORRECT_WORDS
  | Correct Term       | Incorrect Variants                                  |
|--------------------|-----------------------------------------------------|
| voiceflow          | voicflow, voice flow, voiselo, voizeflo, voiceflwo, voiclo, voicelo |
| voiceflow.studio   | voiselo.studio, voicflwo.studio, voiclo.studio, voicelo.studio     |
| Tico               | tiko, teako, teeco, ticau                           |
| NiKo               | nico, niko, nicoo, nicau                            |
  ` */
  axios
    .post(`https://whisper.voiceflow.studio/asr`, formData, {
      params: {
        language: 'en',
        initial_prompt: `The following is a conversation recorded by Niko, which might includes Voiceflow related terms like Tico, voiceflow, voiceflow.com, voiceflow.studio, other voiceflow subdomains and URLs, steps, prompt, utterance, intent and API related terms. Here is a list of other possible words: Tico, Tico Me, kb, knowledge base, debug, combine blocks. Translate the conversation in English if needed.`,
        encode: false,
        task: 'transcribe',
        vad_filter: true,
        word_timestamps: false,
        output: 'txt',
      },
      headers: formData.getHeaders(),
    })
    .then((response) => {
      console.log('TRANSCRIPT:', response.data)
      if (response.data.trim().length < 10) {
        return
      }

      // First test with KB file upload

      /* let form = new FormData()
      let doc = JSON.stringify({
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        content: response.data,
      })

      form.append('file', doc, {
        filename: `audio-${Date.now()}.txt`,
      })
      form.append('canEdit', 'true')
      */

      //let request = {
      //  method: 'post',
      //  url: `https://api.voiceflow.com/v3/projects/661ce8dd2e0bffa2c4779704/knowledge-base/documents/file`,
      //  headers: {
      // accept: 'application/json, text/plain, */*',
      //    'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
      //    authorization: 'VF.DM.661ce8e62c3bb2adfeb73d37.e3VJJgg1kVFpo3n0',
      //    ...form.getHeaders(),
      //  },
      //  data: form,
      //}

      // KB table upload
      let nowTime = new Date().toLocaleTimeString()
      let nowDate = new Date().toLocaleDateString()
      let doc = JSON.stringify({
        data: {
          name: filename, //`audio-${nowDate}-${nowTime}`,
          searchableFields: ['content'],
          items: [
            {
              content: response.data.trim(),
              time: nowTime,
              date: nowDate,
            },
          ],
          metadataFields: ['time', 'date'],
          tags: [],
        },
      })

      let request = {
        method: 'post',
        url: `https://api.voiceflow.com/v3alpha/knowledge-base/docs/upload/table`,
        headers: {
          'content-type': `application/json`,
          authorization: process.env.VF_API_KEY,
        },
        data: doc,
      }

      return axios(request)
        .then(function (response) {
          console.log(
            `Uploading ${filename} to KB | ${response.data.data.status.type}`
          )
          fs.unlink(filePath, (err) => {
            if (err) throw err
            // console.log('Local file deleted.')
          })
          return
        })
        .catch(function (error) {
          console.log('Error uploading transcript:', error.response.data)
          return
        })
    })
    .catch((error) => {
      console.error('Error uploading file:', error)
    })
}

function createTray() {
  if (!tray) {
    tray = new Tray(path.join(__dirname, '/icons/icon_32x32.png'))
  }
  updateTrayMenu() // Call updateTrayMenu to set the initial context menu
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isRecording ? 'Stop' : 'Start',
      click: () => {
        if (isRecording) {
          stopRecording(recorder, filePath)
        } else {
          startRecording()
        }
        updateTrayMenu() // Update the tray menu each time the recording state changes
      },
    },
    {
      label: 'Settings',
      click: createSettingsWindow,
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        tray.destroy() // Add this line to hide the tray
        app.quit()
      },
    },
  ])
  tray.setToolTip('Audio Recorder')
  tray.setContextMenu(contextMenu)
}

app.whenReady().then(() => {
  createSettingsWindow()
  createTray()
  settingsWindow.once('ready-to-show', () => {
    startRecording()
    updateTrayMenu()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
