# If the Power Goes Out

> Your work is safe. Here is what to do — and it is only one step.

---

## The short version

There is one sentence, and this is it:

> If your computer restarts or we get disconnected: open the <Terminal app | PowerShell>, type `<launcher> --resume`, press Return, pick this project from the list, and I carry on from where I was.

That is the whole recovery. Nothing is lost. Nothing is redone.

---

## Why your work is safe

Everything the build knows about your project lives in **files on your computer** — not in the chat, not in the AI's memory, not in something that disappears when the power goes out.

When the build was running, it was writing down what it finished, what it was working on, and what was left to do — **every single time it finished a piece**, before it moved to the next. That record is on your disk right now, even if the power went out mid-build.

So when you start up again, the new session reads that record, sees exactly where things stopped, and continues from there. It does not start over. It does not ask you the questions again. It just keeps going.

---

## Step by step (if you want more detail)

1. **Turn your computer back on.**

2. **Open the <Terminal app | PowerShell>.**

3. **Type `<launcher> --resume` and press Return.**

4. **Pick this project from the list.** That is it — the build reads where it left off and continues, and you can walk away again.

The same sentence is written down for you in your project folder, in a file called `CONTROL/LAUNCH-COMMAND.md`:

```
~/Downloads/projects/<your-project-name>/CONTROL/LAUNCH-COMMAND.md
```

---

## What if something seems wrong after the crash?

The build is designed to check itself before continuing. It will:

- **Verify what actually made it to GitHub** (not just what it thought it finished — it checks the real record).
- **Clean up any half-finished work** that was interrupted mid-edit (it stashes it safely, then starts fresh on that piece).
- **Skip anything that is already done** — it will not rebuild pieces that already landed.

If it finds something it cannot resolve on its own, it will tell you in plain language what happened and what it needs from you. That is rare — the system is built to handle crashes on its own.

---

## The one thing to know

**You never lose finished work.** Every piece that was finished and pushed to GitHub is permanent. A crash can only interrupt work that was in progress — and even that is recovered automatically.

This is not a promise. It is how the system was designed. The record is written to disk **before** the build moves to the next step, every time. That is the whole reason the record exists.

---

*You are safe. Type the one line. Go get a coffee.*
