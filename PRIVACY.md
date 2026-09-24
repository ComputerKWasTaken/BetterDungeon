# BetterDungeon Privacy Policy

Effective date: September 24, 2026

BetterDungeon is a browser extension and Android app that adds features to AI Dungeon. This policy explains the data BetterDungeon handles when you use those features. BetterDungeon does not operate an account system or a developer-controlled server that receives your adventure data, API keys, or usage analytics. It does not sell your data or use it for advertising.

## Data handled on your device

BetterDungeon reads the parts of the AI Dungeon adventure and interface needed for the features you use. Depending on the feature, this can include story text and actions, Plot Components, Story Cards, Memory Bank entries, scenario fields, and the current adventure identifier. It also handles information you enter into BetterDungeon, such as input history, Adventure Notes, presets, Navigator chats and Routines, feature settings, and optional AI-provider API keys. When an AI Dungeon script uses a permitted Ultrascripts module, BetterDungeon may also provide it with requested device, browser, language, time-zone, or network-status details.

BetterDungeon stores this information in browser extension storage or, on Android, the app's local storage. Adventure Notes, input history, Navigator conversations and Routines, presets, and AI-provider keys are stored locally. Some preferences, such as enabled features, hotkeys, and display settings, use the browser's sync storage and may be copied by your browser provider to your signed-in browsers if sync is enabled. BetterDungeon's developer does not receive those synced settings.

## When data leaves your device

- **AI Dungeon:** BetterDungeon uses the AI Dungeon page and its existing authenticated connection to read adventure information and perform the game actions or edits you request or enable. AI Dungeon receives those actions and edits as part of its service. BetterDungeon does not ask for or store your AI Dungeon password.
- **Your selected AI provider:** If you configure and use an AI feature, BetterDungeon sends the request to your selected provider: Google's Gemini API, Mistral, OpenRouter, or a custom HTTPS endpoint you configure. Requests can contain your prompt, relevant adventure content, Navigator or Routine instructions, and information supplied by a permitted Ultrascript. The API key you provide is sent to its provider to authenticate the request. If Advanced-provider fallback is available and you have configured Gemini, the same request may also be sent to Google after the first provider fails. Each provider handles received data under its own terms and privacy policy. AI features can also run automatically when you enable a Navigator Routine.
- **Weather:** When an Ultrascript uses BetterDungeon's Weather module, the requested place name or coordinates are sent to Open-Meteo for geocoding or forecast data.
- **Script-selected web requests:** BetterDungeon's WebFetch module lets a permitted Ultrascript make bounded requests to public HTTPS destinations selected by that script. The destination receives the requested URL, including any information the script puts in it, and ordinary network information such as your IP address. WebFetch does not attach your browser cookies or authentication headers.
- **Update checks:** On installs that did not come from a browser store — the Android app and manually installed extension copies — BetterDungeon periodically requests public release metadata (version tag and download links) from the GitHub Releases API to tell you when a newer release exists. The request sends no personal information; GitHub receives ordinary network information such as your IP address. You can turn this off from the update-checks toggle in the popup's What's New section.
- **Contact options:** The Contact button offers links to Discord and the Reddit profile `u/ComputerKYT`. Opening either link takes you to that service, which handles anything you send there under its own policy. Choosing **Open email app** passes the topic and message you entered to your email app in a draft addressed to `computerk1337@gmail.com`. Your email app supplies the sending address. You review and send the draft from that app; BetterDungeon cannot tell whether you sent it. BetterDungeon does not store feedback drafts or send them to a developer-controlled server.
- **Browser sync:** If your browser syncs extension preferences, your browser provider processes the synced settings according to its own privacy policy. AI-provider keys and the locally stored adventure data described above are not placed in browser sync storage by BetterDungeon.

Opening an external link in BetterDungeon, such as the AI-provider key pages or BetterRepository, takes you to that site's own service and privacy policy. BetterDungeon does not send your stored adventure data to those sites merely because you open a link.

## Your choices and retention

Most features can be turned off in BetterDungeon. AI features require a provider you configure; you can clear saved keys in the AI tab. Navigator Routines start disabled and run automatically only when you enable them. Ultrascripts modules are permission-controlled. Data in local extension or app storage remains until you remove it, clear that storage, or uninstall BetterDungeon. Browser-synced preferences may remain in your browser account until you clear them there. Third-party services control their own retention of data sent to them; consult their policies for details.

## Changes and contact

This policy may be updated when BetterDungeon's features or data handling change. The effective date above will be revised when that happens. For privacy questions, use the Contact button to prepare an email to `computerk1337@gmail.com`, find `computerK` on Discord, or message [u/ComputerKYT on Reddit](https://www.reddit.com/user/ComputerKYT/). You can also open a [GitHub issue](https://github.com/ComputerKWasTaken/BetterDungeon/issues), but please do not post API keys, private story content, or other sensitive information in a public issue.
