import { app, BrowserWindow, Tray, Menu } from 'electron'
import record from 'node-record-lpcm16'
import fs from 'fs'
import path, { join } from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import FormData from 'form-data'
import ElectronStore from 'electron-store'
import PQueue from 'p-queue'
import { platform } from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load config.json
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8')
)
const queueRecording = new PQueue({ concurrency: 3 })
const store = new ElectronStore()
let file
let tray = null
let aboutWindow = null
let isRecording = false
let forceStop = false
let recorder = null
let filePath = null
let pauseTrigger = config.pauseTrigger.toFixed(1)
const whisperUrl = config.whisperUrl
const voiceflowApiKey = config.voiceflowApiKey
const voiceflowProjectId = config.voiceflowProjectId || null
const initialPrompt = config.initialPrompt || ''
const kbJSON = config.kbJSON || false
let isApp = true

const tmpdir = app.getPath('temp')

if (process.defaultApp) {
  console.log('Running via npm start')
  isApp = false
}

function getSoxPath() {
  let soxPath
  switch (platform()) {
    case 'darwin':
      if (isApp) {
        soxPath = path.join(process.resourcesPath, 'sox', 'mac')
      } else {
        soxPath = './resources/sox/mac'
      }
      break
    case 'win32':
      if (isApp) {
        soxPath = path.join(process.resourcesPath, 'sox', 'win32')
      } else {
        soxPath = './resources/sox/win32'
      }
      break
    /* case 'linux':
        soxPath = path.join(process.resourcesPath, 'sox', 'linux')
        break;
      */
    default:
      throw new Error('Unsupported platform')
  }
  return soxPath + '/'
}

function createAboutWindow(show = false) {
  if (aboutWindow) {
    aboutWindow.show()
    return
  }
  aboutWindow = new BrowserWindow({
    width: 500,
    height: 200,
    titleBarStyle: 'hiddenInset',
    closable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: show,
  })

  aboutWindow.loadFile('about.html')

  aboutWindow.on('closed', () => {
    aboutWindow = null
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

  filePath = path.join(tmpdir, `audio-${Date.now()}.wav`)
  file = fs.createWriteStream(filePath, { encoding: 'binary' })

  recorder = record.record({
    sampleRate: 16000,
    verbose: false,
    channels: 1,
    recorder: 'rec', //'sox',
    endOnSilence: true,
    thresholdStart: 2.0,
    thresholdEnd: 1.8,
    //execFile: 'rec',
    silence: pauseTrigger,
    audioType: 'wav',
    recorderPath: getSoxPath(),
  })

  console.log('Recording started')

  recorder.stream().pipe(file)

  file.on('finish', async () => {
    // Handle silence detection and end of file here
    console.log('File saved:', filePath)
    queueRecording
      .add(() => sendFileToWhisper(filePath))
      .then((result) => {
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
    file.close()
  })
}

function stopRecording(recorder, filePath) {
  if (!isRecording) {
    console.log("Attempt to stop recording, but it's not currently recording.")
    return
  }
  console.log('Stopping recording...')

  isRecording = false
  forceStop = true
  recorder.stop()
  file.end()

  console.log('Recording stopped.')
}

async function sendFileToWhisper(filePath) {
  const formData = new FormData()
  const filename = path.basename(filePath)

  function getFilenameWithoutExtension(filePath) {
    return path.basename(filePath, path.extname(filePath))
  }

  const fileWithoutExtension = getFilenameWithoutExtension(filePath)

  const file = formData.append('audio_file', fs.createReadStream(filePath), {
    filename: filename,
    contentType: 'audio/wav',
  })

  axios
    .post(whisperUrl, formData, {
      params: {
        language: 'en',
        initial_prompt: initialPrompt,
        encode: false,
        task: 'transcribe',
        vad_filter: true,
        word_timestamps: false,
        output: 'txt',
      },
      headers: formData.getHeaders(),
    })
    .then((response) => {
      if (response.data.trim().length < 10) {
        return
      }

      console.log('TRANSCRIPT:', response.data)
      let request
      let nowTime = new Date().toLocaleTimeString()
      let nowDate = new Date().toLocaleDateString()

      if (kbJSON !== true) {
        let form = new FormData()

        form.append('file', response.data, {
          filename: `${fileWithoutExtension}.txt`,
          contentType: 'text/plain',
        })

        request = {
          method: 'post',
          url: `https://api.voiceflow.com/v3alpha/knowledge-base/docs/upload?maxChunkSize=1500&overwrite=true`,
          headers: {
            clientkey: 'TICO_ME',
            'content-type': `multipart/form-data`,
            Authorization: voiceflowApiKey,
            ...form.getHeaders(),
          },
          data: form,
        }
      } else {
        // KB table upload
        let doc = JSON.stringify({
          data: {
            name: fileWithoutExtension,
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

        request = {
          method: 'post',
          url: `https://api.voiceflow.com/v3alpha/knowledge-base/docs/upload/table`,
          headers: {
            'content-type': `application/json`,
            authorization: voiceflowApiKey,
          },
          data: doc,
        }
      }

      return axios(request)
        .then(function (response) {
          console.log(
            `Uploaded ${fileWithoutExtension} to KB | ${response.data.data.status.type}`
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
  updateTrayMenu()
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
        updateTrayMenu()
      },
    },
    {
      label: 'About',
      click: () => {
        createAboutWindow(true)
      },
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        if (tray) tray.destroy()
        if (aboutWindow) aboutWindow.close()
        app.quit()
      },
    },
  ])
  tray.setToolTip('Tico Me')
  tray.setContextMenu(contextMenu)
}

app
  .whenReady()
  .then(() => {
    if (process.platform === 'darwin') {
      app.dock.hide()
    }
    createAboutWindow()
    createTray()
    aboutWindow.once('ready-to-show', () => {
      // If you want to start recording on launch, uncomment this line:
      // startRecording()
      updateTrayMenu()
    })
  })
  .catch((error) => {
    console.error('Error during app initialization:', error)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || app.isQuitting) {
    app.quit()
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
})

app.on('quit', () => {
  process.exit(0)
})
