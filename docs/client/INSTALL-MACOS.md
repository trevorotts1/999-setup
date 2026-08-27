# Installing Candice

One command. **You should not see any security warning.**

---

## Install everything

Candice comes with the rest of the setup — you don't install her separately.
In the same terminal window where you run Claude, from inside the folder you
downloaded this repository into, run:

```
node scripts/candice-bootstrap/bootstrap.mjs install --mode release
```

That one command installs the skills, the Claude plugin, and Candice's voice
files. Run the same command again any time to update.

When it finishes it tells you exactly what it installed. If it says **APP NOT
INSTALLED**, that is not an error — see the next section.

---

## "APP NOT INSTALLED" — what that means

Candice has two halves:

- **The part that talks to Claude.** Installed by the command above. Working.
- **The character on your screen.** A separate app, and it is not published
  yet.

Until that app ships, everything still works — Claude just asks you questions
in your terminal window instead of Candice asking them out loud. Nothing is
broken and nothing is missing. When the app is published, the same command
above installs it too.

---

## If you were handed the app as a file

If someone sends you Candice directly — on a USB stick, or copied to your Mac
— open the folder it's in and run:

```
./install-candice-macos.sh
```

It puts her in your Applications folder and checks she arrived undamaged.
It'll say **"Done. Candice is in your Applications folder."** Open her the
normal way, from Applications.

---

## Turning her off

Candice has a **Turn off** button on her, under the Animation switch. Press
it and she closes.

That's safe. She opens again on her own the next time Claude asks you
something, so you never have to go and start her back up.

The **Animation** switch next to it is a different thing — it stops her
moving but leaves her on screen. If you want her gone, use **Turn off**.

---

## Why there's no security warning, and why that's safe

macOS shows *"Apple could not verify this app"* when a file carries a
**quarantine flag**. That flag is written by whatever **downloaded** the
file — Safari, Chrome, Mail, Messages. It is not part of the app, and it
says nothing about whether the app is safe.

The installer removes that one flag from this one app, which is exactly what
the old right-click → **Open** trick did before macOS 15 took it away.

It does **not** turn off your Mac's protection. Nothing else on your machine
is affected, and every other app is still checked exactly as before. You can
remove Candice by dragging her to the Trash, and nothing is left behind.

The installer also checks her signature before finishing. If she was damaged
or altered on the way to you, it refuses to install and tells you to ask for
a fresh copy.

---

## Let her hear you (optional)

The first time you hold the talk button, your Mac asks permission to use the
microphone. Click **OK**.

Clicked "Don't Allow" by mistake? Turn it back on in **System Settings →
Privacy & Security → Microphone**.

You never have to use the microphone. You can always type instead.

---

## If something goes wrong

**I double-clicked the app before running the installer, and got a warning.**
Click **Done**, then run the installer. It fixes it. You won't be asked again.

**Candice doesn't appear when I run a command.**
Turn her off, open her once from Applications, then try again.

**She opens but doesn't speak.**
Everything she says is also on screen, so you won't miss anything. If she
can't use her own voice, she says so and uses your Mac's built-in voice.

**The window is in my way.**
Drag her anywhere. She remembers where you put her.

---

## What she does with your information

Everything she hears stays on your Mac. Your voice is never uploaded, never
sent to a speech service on the internet, and never kept after she's turned
it into text. The microphone is only live while you hold the talk button down.

---

## Windows

Windows hasn't shipped yet. When it does, the same idea applies: Windows
marks downloaded files with a flag called *Mark of the Web*, and SmartScreen
reacts to that flag, not to the app. Files delivered by the installer or on a
USB stick don't carry it. If you ever do see a SmartScreen box, choose
**More info → Run anyway** once.
