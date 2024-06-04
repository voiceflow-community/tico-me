import { exec } from 'child_process'
import os from 'os'

function installSox() {
  const platform = os.platform()
  let installCommand

  if (platform === 'darwin') {
    installCommand = 'brew install sox'
  } else if (platform === 'linux') {
    installCommand = 'sudo apt-get install -y sox libsox-fmt-all'
  } else if (platform === 'win32') {
    installCommand = 'choco install sox.portable'
  } else {
    console.error('Unsupported platform:', platform)
    return
  }

  exec(installCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error installing SoX: ${error.message}`)
      return
    }
    console.log(`SoX installed: ${stdout}`)
  })
}

exec('sox --version', (error) => {
  if (error) {
    console.log('SoX not found, installing...')
    installSox()
  } else {
    console.log('SoX is already installed.')
  }
})
