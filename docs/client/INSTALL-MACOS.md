# Installing Candice

Two minutes, once. **You should not see any security warning.**

---

## The short version

You'll be given either a link or a file. Either way, run the installer — it
puts Candice in your Applications folder and checks she arrived undamaged.

**If you were given a link**, paste this one line into the same terminal
window where you run Claude, replacing the address with the one you were
sent:

```
curl -fsSL https://YOUR-LINK-HERE/install-candice-macos.sh | bash -s -- https://YOUR-LINK-HERE/candice.zip
```

**If you were given a file** (on a USB stick, or copied to your Mac), open
the folder it's in and run:

```
./install-candice-macos.sh
```

It will say **"Done. Candice is in your Applications folder."** Open her the
normal way — from Applications, or however you'd open any app.

---

## Why there's no warning, and why that's safe

macOS shows *"Apple could not verify this app"* when a file carries a
**quarantine flag**. That flag is written by whatever **downloaded** the
file — Safari, Chrome, Mail, Messages. It is not part of the app, and it
says nothing about whether the app is safe.

The installer removes that one flag from this one app, which is exactly what
the old right-click → **Open** trick did before macOS 15 took it away.

It does **not** turn off your Mac's protection. Nothing else on your machine
is affected, and every other app is still checked exactly as before. If
that's ever not what you want, you can delete Candice by dragging her to the
Trash and nothing is left behind.

The installer also checks Candice's signature before finishing. If she was
damaged or altered on the way to you, it refuses to install her and tells
you to ask for a fresh copy.

---

## Let her hear you (optional)

The first time you hold the talk button, your Mac asks permission to use the
microphone. Click **OK**.

Clicked "Don't Allow" by mistake? Turn it back on in **System Settings →
Privacy & Security → Microphone**.

You never have to use the microphone. You can always type your answers
instead.

---

## If something goes wrong

**I double-clicked the app before running the installer, and got a warning.**
Click **Done**, then run the installer. It fixes it. You won't be asked
again.

**Candice doesn't appear when I run a command.**
Quit her completely, open her once from Applications, then try again.

**She opens but doesn't speak.**
Everything she says is also shown on screen, so you won't miss anything. If
she can't use her own voice, she'll say so and use your Mac's built-in voice
instead.

**The window is in my way.**
Drag her anywhere. She remembers where you put her.

---

## What she does with your information

Everything she hears stays on your Mac. Your voice is never uploaded, never
sent to a speech service on the internet, and never kept after she's turned
it into text. The microphone is only ever live while you hold the talk
button down.

---

## Windows

Windows hasn't shipped yet. When it does, the same idea applies: Windows
marks downloaded files with a flag called *Mark of the Web*, and SmartScreen
reacts to that flag, not to the app. Files delivered by the installer or on
a USB stick don't carry it. If you ever do see a SmartScreen box, choose
**More info → Run anyway** once.
