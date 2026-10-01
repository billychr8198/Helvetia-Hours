# Helvetia Hours

A Swiss-themed focus timer. You climb for 60 minutes, rest with a 10 minute Gipfeli break, and take a 40 minute Fondue break after every 4 climbs. Every full hour of focus opens one new chapter of a Swiss documentary, and your 3D village in the valley grows by one chalet.

## Put it online with GitHub Pages

1. Create a new repository on GitHub (for example `helvetia-hours`).
2. Upload **the contents of this folder** to the root of the repository: `index.html`, `.nojekyll`, `README.md` and the `css`, `js` and `assets` folders.
   - The web uploader takes at most 100 files at a time. There are about 190 files, so upload in two rounds: first everything except `assets/cantons`, then the `assets/cantons` folder. GitHub Desktop or `git push` also works in one go.
3. Open **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then Save.
4. After a minute your site is live at `https://<your-username>.github.io/<repository-name>/`.

## Test it on your computer

Do not double-click `index.html`. YouTube refuses to play inside pages opened as files. Start a small local server instead:

```
cd helvetia-hours
python -m http.server 8000
```

Then open http://localhost:8000 in your browser.

## Files

```
index.html               all pages, dialogs and icons
css/styles.css           design
js/data.js               film chapters, 26 cantons (stories, photos, map shapes)
js/scene.js              3D valley (three.js)
js/app.js                timer, tasks, unlocks, report, settings
js/player.js             chapter-locked YouTube player
js/map.js                canton map and photo viewer
assets/vendor/           three.js r158 (MIT licence)
assets/audio/            Edelweiss alarm
assets/cantons/<name>/   flag, photos and thumbnails for each canton
assets/icons/            favicon
.nojekyll                tells GitHub Pages to serve the files as they are
```

## Things you may want to change

- **Level 2 video.** The "More than Chocolate and Cheese" film uses the YouTube ID `OkL-pJdPQds`. Open `js/data.js`, search for that ID, and replace it if your video has a different one (the part after `watch?v=` in its link).
- **Chapter times.** Every chapter in `js/data.js` has `start` and `end` in seconds. The intro of Level 1 is free.
- **Default timer.** The 60/10/40 rhythm, sounds and 3D quality can all be changed in the Settings window; nothing needs code.

## How the chapter lock works

Videos play through the privacy-enhanced player (`youtube-nocookie.com`). YouTube's own controls and keyboard shortcuts are switched off and the video is covered, so the only controls are Helvetia Hours' own: play, pause, back and forward 10 seconds, a seek bar limited to the chapter, volume and fullscreen. If playback ever leaves the chapter, it is pulled back, and it stops at the chapter's end.

## Why the timer stays accurate when the tab is minimized

Browsers slow down timers in hidden tabs, so a countdown that subtracts one second every tick falls behind or freezes. Helvetia Hours never counts down. It saves the exact moment a session started and computes the remaining time from the real clock every time it looks. A small Web Worker sends a heartbeat four times a second (workers are not throttled like hidden pages), so the session ends on time, the alarm plays and the next session starts at the exact second the last one ended. The state is saved continuously, so even if the browser is closed, a session that finished while you were away is counted when you come back.

Desktop alerts can be turned on in Settings. On iPhone and iPad, web alerts only work after "Add to Home Screen".

## Your data

Progress, tasks and settings are saved in your browser (localStorage) on this device only. Use **Report → Backup** to download a backup file and load it on another computer or browser.

## Keyboard shortcuts

Space start/pause · N skip · R restart session · E explore the valley · Esc close

## Credits

- Swiss canton map: generated with [MapChart](https://www.mapchart.net/), CC BY-SA 4.0.
- Canton photos and flags: Wikimedia Commons. Each photo links to its source page and licence from the photo viewer.
- Canton stories: "A Journey Through the Swiss Cantons" (provided by the site owner).
- 3D engine: [three.js](https://threejs.org/), MIT licence.
- Typeface: [Archivo](https://fonts.google.com/specimen/Archivo), SIL Open Font Licence.
- Films: shown with the YouTube embedded player; all rights belong to their creators.
- Alarm: "Edelweiss" piano recording provided by the site owner. Edelweiss is a copyrighted song (Rodgers & Hammerstein), so if this repository is public, make sure you are allowed to share this recording, or replace `assets/audio/edelweiss.mp3` with another file of the same name.
