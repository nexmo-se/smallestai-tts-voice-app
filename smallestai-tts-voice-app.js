'use strict'

//-------------

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser')

const app = express();
app.use(bodyParser.json());

const axios = require('axios');

const fs = require('fs');
const path = require('path');
const { readFileSync } = require('fs');
const crypto = require('crypto');

//--

const MultiQueue = require("./multi-queue.js");
const qm = new MultiQueue();  // qm: queue manager

//---- CORS policy - Update this section as needed ----

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");
  next();
});

//-------

const servicePhoneNumber = process.env.SERVICE_PHONE_NUMBER;

//-------

// Greeting TTS
const greetingTts = "Hello! Press a digit key once or a few times to hear jokes."

// Where to retrieve jokes
const jokeUrl = "https://official-joke-api.appspot.com/random_joke";

//-------

const playBackInProgress = {};  // track if a TTS playback is in progress on a given call uuid

//--- Vonage API ---

const { Auth } = require('@vonage/auth');

const credentials = new Auth({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  applicationId: process.env.APP_ID,
  privateKey: './.private.key'    // private key file name with a leading dot 
});

const { Vonage } = require('@vonage/server-sdk');

// const vonage = new Vonage(credentials, options);
const vonage = new Vonage(credentials);

//--- Voice API application server host name ---
let voiceApplicationServer; // will be set on first incoming webhook call from Vonage platform

//---- Custom settings ---
const maxCallDuration = process.env.MAX_CALL_DURATION; // in seconds

//--- Smallest.ai ---
const smallestAiApiKey = process.env.SMALLEST_AI_API_KEY
const smallestAiTtsModel = process.env.SMALLEST_AI_TTS_MODEL
const ttsVoiceList = process.env.SMALLEST_AI_SOME_TTS_VOICES.split(","); // array
console.log('\nTTS Voice list:', ttsVoiceList);

// ─── Audio file registry (tracks which file is currently "active") ────────────
const AUDIO_DIR = path.join(__dirname, 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

const TOKEN_TTL_MS = 600_000; // 10 mins, i.e 600 seconds, auto-revoke if Vonage never fetches

// Registry supports multiple concurrent tokens (multiple calls, multiple audio files per call)
// Map structure: token -> { filename, timer }
const audioRegistry = new Map();

/**
 * Registers a newly synthesized file with a unique token.
 * Multiple tokens can be active simultaneously (one per audio file / call leg).
 * A TTL timer is started per token; if not consumed within TOKEN_TTL_MS it is
 * automatically revoked and the file deleted.
 */
function registerAudioToken(token, filename) {
  const timer = setTimeout(() => {
    console.warn(`[Audio] Token TTL expired (${TOKEN_TTL_MS}ms) — revoking: ${token}`);
    revokeAudioToken(token);
  }, TOKEN_TTL_MS);

  audioRegistry.set(token, { filename, timer });
  console.log(`[Audio] Token registered: ${token} → ${filename} (registry size: ${audioRegistry.size})`);
}

/**
 * Invalidates a specific token, clears its TTL timer, and deletes its audio file from disk.
 */
function revokeAudioToken(token) {
  const entry = audioRegistry.get(token);
  if (!entry) return;

  clearTimeout(entry.timer);

  const filePath = path.join(AUDIO_DIR, entry.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[Audio] Deleted file: ${filePath}`);
  }

  audioRegistry.delete(token);
  console.log(`[Audio] Token revoked: ${token} (registry size: ${audioRegistry.size})`);
}

// ─── Protected audio route (multi-call, multi-file support) ──────────────────
/**
 * GET /audio/:token/:filename
 *
 * Protection rules:
 *  1. No directory listing  — the route only matches an exact token + filename.
 *  2. Token validation      — the token must exist in the registry.
 *  3. Filename validation   — the filename must match what was registered for that token.
 *  4. Path traversal guard  — rejects any filename containing ".." or "/".
 *  5. Single-use            — the token is revoked immediately after the file is served,
 *                             so subsequent requests (even with the same URL) return 404.
 *  6. Concurrent-safe       — each token is independent; multiple calls are served in parallel.
 */
app.get('/audio/:token/:filename', (req, res) => {
  const { token, filename } = req.params;

  // Guard: path traversal
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).end();
  }

  // Guard: token must exist in the registry
  const entry = audioRegistry.get(token);
  if (!entry) {
    return res.status(404).end();
  }

  // Guard: filename must match what was registered for this token
  if (entry.filename !== filename) {
    return res.status(404).end();
  }

  const filePath = path.join(AUDIO_DIR, filename);
  if (!fs.existsSync(filePath)) {
    revokeAudioToken(token);
    return res.status(404).end();
  }

  // Serve the file, then immediately revoke this specific token.
  // revokeAudioToken() is idempotent — safe to call from multiple handlers.
  res.setHeader('Content-Type', 'audio/mpeg');  // to be checked <<<<<<<<
  res.setHeader('Cache-Control', 'no-store');
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  // 1 - Normal completion — file fully sent
  fileStream.on('close', () => {
    // setTimeout( () => {
      revokeAudioToken(token);
      console.log(`[Audio] File served and cleaned up (close): ${token}`);
    // }, 10000);  // keep file for 10 more seconds  
  });

  // 2 - Read error — e.g. file vanished mid-stream
  fileStream.on('error', (err) => {
    console.error(`[Audio] Stream read error for token ${token}:`, err.message);
    revokeAudioToken(token);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });

  // 3 - Client disconnected before stream finished
  res.on('close', () => {
    revokeAudioToken(token);
    console.log(`[Audio] Client disconnected — cleaned up token: ${token}`);
  });
});

// ─── Smallest.ai Waves TTS Helper ────────────────────────────────────────────
/**
 * Calls Smallest.ai Waves /tts endpoint and saves the audio to disk.
 * Returns the protected public URL of the saved file.
 *
 * API: POST https://api.smallest.ai/waves/v1/tts  (v4 unified endpoint — latest)
 * Docs: https://docs.smallest.ai/waves/documentation/getting-started/introduction
 */

async function synthesizeSpeech(text, language, filename, voice = 'blake') {
  try {
    const response = await axios.post(
      'https://api.smallest.ai/waves/v1/tts',
      {
        text,
        model: smallestAiTtsModel,
        voice_id: voice,
        sample_rate: 16000,
        speed: 1.0,
        // Remove these fields if not supported by Pro model
        // consistency: 0.5,
        // similarity: 0,
        // enhancement: 1,
        language: 'en',
        output_format: 'mp3',
      },
      {
        headers: {
          Authorization: `Bearer ${smallestAiApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        responseType: 'arraybuffer',
      }
    );
    const filePath = path.join(AUDIO_DIR, filename);
    fs.writeFileSync(filePath, response.data);
    console.log(`TTS Audio saved to ${filePath}`);
    const token = crypto.randomBytes(32).toString('hex');
    registerAudioToken(token, filename);
    return `${voiceApplicationServer}/audio/${token}/${filename}`;
  } catch (error) {
    if (error.response?.data) {
      const errorText = error.response.data.toString();
      const firstLine = errorText.split('\n')[0];
      console.error('Smallest.ai API Error:', firstLine);
    }
  }
}

//-------------------------- Get list of voices -------------------------

// The output of this function is not reliable
// async function getAvailableVoices() {
//   try {
//     const response = await axios.get(
//       'https://api.smallest.ai/waves/v1/lightning-v3.1/get_voices',
//       {
//         headers: {
//           Authorization: `Bearer ${smallestAiApiKey}`
//         }
//       }
//     );
//     const { voices } = response.data;
//     console.log('Available voices:', voices);
//     return voices;
//   } catch (error) {
//     if (error.response) {
//       throw new Error(`HTTP ${error.response.status}: ${error.message}`);
//     }
//     throw error;
//   }
// }

// (async () => {
//   const voices = await getAvailableVoices();
//   console.log(voices);
// })();  

//----------------------------- Queue jokes -----------------------------

async function queueJokes(uuid) {

  // random number of jokes (2 or 3)
  const numberOfJokes = Math.floor(Math.random() * (2)) + 2;

  // TTS to be played for this call leg with designated uuid
  qm.enqueue(uuid, {ttsText: `Hello! You are going to hear ${numberOfJokes} jokes!`, ttsLanguage: 'en-US'});

  for (let i = 0; i < numberOfJokes; i++) {

    try { 
      const response = await axios.get(jokeUrl);
      // console.log('User data:', response.data);
      qm.enqueue(uuid, {ttsText: `${response.data.setup} ${response.data.punchline}`, ttsLanguage: 'en-US'});
    } catch (error) {
      console.error('Error fetching joke:', error);
      qm.enqueue(uuid, {ttsText: 'Sorry, I could not produce any joke. Please try again later', ttsLanguage: 'en-US'});
    }
  }

  qm.enqueue(uuid, {ttsText: `Good bye until next time!`, ttsLanguage: 'en-US'});

  // Just for info  
  // console.log('\n>>> Queues:\n', qm.returnQueues());

}

//----------------------------------------------------------------------------------------

//-- Inbound calling 
console.log('\nYou may call in by dialing', servicePhoneNumber);

//-- Manually trigger outbound PSTN call to a number --
//-- see sample request below --
//-- sample request: https://<server-address>/call?number=12995550101 --
console.log(`\nManually trigger an outbound PSTN call to a number from a web browser\n\
see sample request web address:\n\
https://<this-server-address>/call?number=12995551212\n`);

//============= Initiating outbound PSTN calls ===============

app.get('/call', async(req, res) => {

  if (req.query.number == null) {

    res.status(200).send('>>> Query parameter "number" is missing - No call is placed');
  
  } else {

    // code may be added here to make sure the numbers are in valid E.164 format (without leading '+' sign)
  
    res.status(200).send('Ok');  

    const hostName = req.hostname;
    voiceApplicationServer = hostName;

    const number = req.query.number;

    //-- Outgoing PSTN call --

    vonage.voice.createOutboundCall({
      to: [{
        type: 'phone',
        number: number
      }],
      from: {
       type: 'phone',
       number: servicePhoneNumber
      },
      length_timer: maxCallDuration, // limit outbound call duration if desired
      answer_url: ['https://' + hostName + '/answer_1' + '?number=' + number],
      answer_method: 'GET',
      event_url: ['https://' + hostName + '/event_1' + '?number=' + number],
      event_method: 'POST'
      })
      .then(res => console.log(">>> Outgoing PSTN call status:", res))
      .catch(err => console.error(">>> Outgoing PSTN call error:", err))

    }

});

//-----------------------------

app.get('/answer_1', async (req, res) => {

  const hostName = req.hostname;
  voiceApplicationServer = hostName;

  const uuid = req.query.uuid;
  const number = req.query.number;

  const nccoResponse = [
    {
      "action": "conversation",
      "name": "conf_" + uuid,
      "startOnEnter": true,
      "endOnExit": true // set to true if there is only one participant
    }
  ];

  res.status(200).json(nccoResponse);

  queueJokes(uuid);

 });

//------------

app.post('/event_1', async(req, res) => {

  res.status(200).send('Ok');

  if (req.body.status == 'completed') {

    console.log('>>> Call terminated - Deleting jokes queue for call', req.body.uuid);
    qm.deletequeue(req.body.uuid);

  }

});

//------------

app.get('/answer', async(req, res) => {

  const hostName = req.hostname;
  voiceApplicationServer = hostName;

  const uuid = req.query.uuid;
  const number = req.query.number;

  const nccoResponse = [
    {
      "action": "conversation",
      "name": "conf_" + uuid,
      "startOnEnter": true,
      "endOnExit": true // set to true if there is only one participant
    }
  ];

  res.status(200).json(nccoResponse);

  queueJokes(uuid);

 });

//------------

app.post('/event', async(req, res) => {

  res.status(200).send('Ok');

  if (req.body.status == 'completed') {

    console.log('>>> Call terminated - Deleting jokes queue for call', req.body.uuid);
    // qm.deletequeue(req.body.uuid);

  }

});

//------------

app.post('/rtc', async(req, res) => {

  res.status(200).send('Ok');

  if (req.body.type == 'audio:play:done') {
    playBackInProgress[req.body.body.channel.id] = false; // uuid = req.body.body.channel.id],  TTS on that leg has finished playing
  }


});

//================ Loop to send TTS requests ========================

const timer = setInterval( async() => {
  
  const queues = qm.returnQueues();
  
  queues.forEach(async (value, key) => {
    
    if (!playBackInProgress[key]) {
    
      playBackInProgress[key] = true;
    
      const ttsPayload = qm.dequeue(key);
    
      if (ttsPayload) {
    
        let fileUrl = null;

        const smallestAiTtsLanguageCode = ttsPayload.ttsLanguage.slice(0, 2);

        // see https://docs.smallest.ai/waves/model-cards/text-to-speech/lightning-v-3-1-pro#voice-catalog
        const voiceId = ttsVoiceList[Math.floor(Math.random() * ttsVoiceList.length)];
    
        try {
    
          fileUrl = await synthesizeSpeech(ttsPayload.ttsText, smallestAiTtsLanguageCode, key + '_' + Date.now() + '_' + crypto.randomBytes(32).toString('hex') + '.mp3', voiceId);
          console.log('fileUrl:', fileUrl);
    
        } catch (error) {
    
          const errorText = error.response?.data?.toString() || error.message;
          const firstLine = errorText.split('\n')[0];
          console.error('Smallest.ai API Error:', firstLine);
    
        }

        if (fileUrl) {

          vonage.voice.streamAudio(key, 'https://' + fileUrl, 1, 0)  // uuid = key, loop = 1, vol = 0  
            .then(resp => console.log('>>> Stream audio on leg', key))
            .catch(err => console.error('>>> Stream audio  error on leg', key, err));   
        
        }
    
        // to be set in RTC webhook when audio playback is done, not here
        // playBackInProgress[key] = false;
    
      } else {
    
        vonage.voice.hangupCall(key)
          .then(res => console.log(">>> Terminating user's call leg", key))
          .catch(err => null)
    
        qm.deletequeue(key);
      }
    }
  });

}, 1000)

//================ For Vonage Cloud Runtime (VCR) only ==============
//--- If this application is hosted on VCR  --------

app.get('/_/health', async(req, res) => {

  res.status(200).send('Ok');

});

//=====================================================================

const port = process.env.VCR_PORT || process.env.PORT || 8000;

app.listen(port, () => console.log(`Voice API application application listening on local port ${port}.`));

//------------