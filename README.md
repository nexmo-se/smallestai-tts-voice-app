# Play TTS to a Voice Call - Smallest.ai TTS

## What this application does

Call in or get called.

You will hear sample TTS as jokes.

## Set up

### Local deployment - Set up part 1 - Internet tunneling service - ngrok

If you plan to test using `Local deployment with ngrok` (Internet tunneling service), here are the instructions to set up ngrok:<br>
- [Install ngrok](https://ngrok.com/download)<br>
- Make sure you are using the latest version of ngrok and not using a previously installed version of ngrok
- Sign up for a free [ngrok account](https://dashboard.ngrok.com/signup)<br>
- Verify your email address from the email sent by ngrok<br>
- Retrieve [your Authoken](https://dashboard.ngrok.com/get-started/your-authtoken)<br>
- Run the command `ngrok config add-authtoken <your-authtoken>`<br>
- Set up the tunnel
	- Run `ngrok config edit`
		- For a free ngrok account, add following lines to the ngrok configuration file (under authoken line):</br>
		<pre><code>	
		tunnels:
			mytunnel:</br>
				proto: http</br>
				addr: 8000</br>
		</code></pre>
		- For a [paid ngrok account](https://dashboard.ngrok.com/billing/subscription), you may set a ngrok hostname that never changes on each ngrok new launch, add following lines to the ngrok configuration file (under authoken line) - set hostname to actual desired value:</br>
		<pre><code>	
		tunnels:
			mytunnel:</br>
				proto: http</br>
				addr: 8000</br>
				hostname: setahostnamehere.ngrok.io</br>
		</code></pre>			
		
- Start the ngrok tunnel
	- Run `ngrok start mytunnel`</br>
	- You will see lines like
		....</br>
		*Web Interface                 http://127.0.0.1:4040</br>                             
		Forwarding                    https://xxxxxx.ngrok.xxx -> http://localhost:8000*</br> 
	- Make note of *https://xxxxxx.ngrok.xxx* (with the leading https://), as it will be needed in the next steps below.</br>	

This Node.js server application (this repository) is running on local port 8000.</br>

### Non local deployment

If you are using hosted servers, for example Vonage Code Runtime, your own servers, or some other cloud providers,
you will need the public hostname and if necessary public port of the server that
runs this server application (from this repository), e.g.</br>
	*`xxxx.xxxx.runtime.vonage.cloud`, `myserver.mycompany.com:40000`*</br>

### Set up your Vonage Voice API application credentials and other parameters

[Log in to your](https://dashboard.nexmo.com/sign-in) or [sign up for a](https://ui.idp.vonage.com/ui/auth/registration) Vonage APIs account.
 
Go to [Your applications](https://dashboard.nexmo.com/applications), access an existing application or [+ Create a new application](https://dashboard.nexmo.com/applications/new).

Under Capabilities section (click on [Edit] if you do not see this section):

**Enable** Voice
- Under Answer URL, leave HTTP GET, and enter</br>
https://\<host\>:\<port\>/answer</br>
(replace \<host\> and \<port\> with the public host name and if necessary public port of the server where this sample application is running)</br>
- Under Event URL, **select** HTTP POST, and enter</br>
https://\<host\>:\<port\>/event</br>
(replace \<host\> and \<port\> with the public host name and if necessary public port of the server where this sample application is running)</br>
Note: If you are using ngrok for this sample application, the answer URL and event URL look like:</br>
https://xxxxxx.ngrok.xxx/answer</br>
https://xxxxxx.ngrok.xxx/event</br></br>

**Enable** RTC (In-app vouce & messaging)
- Under Event URL, **select** HTTP POST, and enter</br>
https://\<host\>:\<port\>/rtc</br>
(replace \<host\> and \<port\> with the public host name and if necessary public port of the server where this sample application is running)</br>
Note: If you are using ngrok for this sample application, the event URL looks like:</br>
https://xxxxxx.ngrok.xxx/rtc</br></br>

- Click on [Generate public and private key] if you did not yet create or want new ones, save the private key file in this application folder as .private.key (leading dot in the file name).</br>

- Click on [Generate new application] if you've just created the application.</br></br>

**IMPORTANT**: If you already have an existing application and just changed some parameter values including created a new public and private key set, do not forget to click on [Save changes] at the bottom of the screen.</br></br>

- Link a phone number to this application.

Please take note of your **application ID** and the **linked phone number** (as they are needed in the next section _Set up part 2_).

For the next steps, you will need:</br>
- Your [Vonage API key](https://dashboard.nexmo.com/settings) (as **`API_KEY`**)</br>
- Your [Vonage API secret](https://dashboard.nexmo.com/settings), not signature secret, (as **`API_SECRET`**)</br>
- Your `application ID` (as **`APP_ID`**),</br>

### Get your smallest.ai API key

Go to https://app.smallest.ai/

Create a new API key or use an existing API key for this project.

Take note of your smallest.ai API key (as **`SMALLEST_AI_API_KEY`**) for the next section.

### Local deployment - Set up part 2

Copy or rename .env-example to .env<br>
Update parameters in .env file<br>

Have Node.js installed on your system, this application has been tested with Node.js version 22.16<br>

Install node modules with the command:<br>
 ```bash
npm install
```

Launch the server application with the following command:<br>
```bash
node smallestai-tts-voice-app
```

Default local (not public!) `port` of either server application is: 8000.

## Try this application

Either call in or get called.

To test call in, call the linked phone number.

To test call a phone number, from a web browser trigger the outbound call with the web address:</br>

`https://<this-application-server-address>/call?number=12995551212` (replace with the actual number)</br>

You will hear sample TTS with different voices.

## Core instruction codes in this application

The two main instruction codes in this application are the lines with:</br>

**`synthesizeSpeech`** which is where Smallest.ai generates the TTS audio payload</br>

and</br>

**`vonage.voice.streamAudio`** which is where the Vonage Voice API "streams" the TTS audio payload into the call.</br>


See more information at:</br>
https://docs.smallest.ai/waves/documentation/text-to-speech-lightning/quickstart</br>

https://developer.vonage.com/en/api/voice#Stream-Audio (REST API)</br>

https://developer.vonage.com/en/tools (Server SDKs section)</br>







