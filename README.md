# WIP | Tico Me

## About
This electron app uses whisper to transcribe audio and uploads the transcript to the Voiceflow Knowledge Base.

## config.json
Rename the `config.json.template` to `config.json` and update the values.

If you have access to the **KB Table (JSON) BETA**, set `kbJSON` to `true`
otherwise, set the `voiceflowProjectId` value to your **project's ID** and set `kbJSON` to `false`

## Whisper

For this demo, we are using the following project to run whisper as a webservice:

Github repo: https://github.com/ahmetoner/whisper-asr-webservice
Doc: https://ahmetoner.github.io/whisper-asr-webservice

To run the whisper webservice, pull the docker image and run the container.

```
docker pull onerahmet/openai-whisper-asr-webservice:latest
docker run -d --restart unless-stopped -p 9000:9000 -e ASR_MODEL=base.en
-e ASR_ENGINE=faster_whisper onerahmet/openai-whisper-asr-webservice:latest
```

Set `whisperUrl` in the `config.json` file to the url of the whisper instance.

## Run the app

```npm install```

Then

```npm start```

