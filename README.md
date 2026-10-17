# R6 Flipbook

A free, frame-by-frame animation maker for Roblox **R6** and **R15** characters, in the style of FlipaClip.

**Use it:** https://animeyeeter123.github.io/r6-flipbook/

- Pose every body part freely with arrows and rings, add frames with **+**, and play them back.
- Linked animations (for example *Run start → Run*), in-betweens, mirror, live mirror, feet on ground, reverse, auto loop.
- Markers and sound markers, extra arms and props, saved poses, a reference video behind the character.
- **Test for Roblox** shows the animation the way the game plays it.
- Exports Roblox `KeyframeSequence` files (`.rbxmx`) that you can import into Roblox Studio.
- Works offline. In Chrome or Edge, click **Install** in the address bar to get it as an app.
- Share your animation as a **GIF**, a **video**, or a **link** that opens it in R6 Flipbook.

## Install it as an app

**Easiest (no download):** open the link above in Chrome or Edge and click the **Install** icon at the right end of the address bar. You get R6 Flipbook in its own window, in your Start menu, working offline, and it updates itself.

**Windows download:** get `R6Flipbook.exe` from [Releases](https://github.com/animeyeeter123/r6-flipbook/releases). It is a tiny (18 KB) launcher that opens R6 Flipbook in its own window using Microsoft Edge, which comes with Windows. It can only open this one website, and its full source code is in the `launcher` folder.
Windows may say *"Windows protected your PC"* because the file isn't paid-signed; click **More info → Run anyway**. Each release lists the file's SHA-256 fingerprint, so you can check you have the real one.

## Works with AI

After you export, R6 Flipbook shows a ready-made message for your AI helper (ChatGPT, Claude and others). Copy it, paste it into the chat and attach the `.rbxmx` file(s). It tells the AI what kind of animation it is (run, idle, jump, combat…), whether it loops, its markers (like `Hit`) and their timing, linked parts (like *Run start → Run*), and any extra arms or props, so the AI can write the script that plays it in your game. You can also get the message any time from **Tools → Get an AI prompt**.

Always read what an AI suggests before using it, and keep a backup of your game.

## Privacy

Everything stays on your own computer. Projects are saved in your browser; nothing is uploaded and there are no accounts, ads or tracking.

## Credits

- 3D rendering: [three.js](https://threejs.org) (MIT licence, see `vendor/THREE-LICENSE.txt`).
- R6 Flipbook is not made by, endorsed by or affiliated with Roblox Corporation. "Roblox" is a trademark of Roblox Corporation.

## Updates

**v1.2**
- Added: R15 bodies (pick R6 or R15 when you start a new animation)

**v1.1**
- Added: share as GIF or video (under Export)
- Added: share by link
- Added: setup message for AI helpers after exporting

**v1.0**
- First release

## Licence

MIT. See `LICENSE`.
