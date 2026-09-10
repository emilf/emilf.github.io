---
title: Amiga 500 Revival
summary: Bringing a 1987 icon into the modern era — good video, real storage, and tinkering that's slowly turning into a Verilog habit.
status: Ongoing
year: 2025–present
permalink: /projects/amiga-500-revival/
---
I've got a few Amiga 500s, and 1987 hardware deserves better than a fuzzy composite signal into a modern TV. This is the ongoing project of getting them usable again — good video, real storage, and a development environment where I can actually write and run 68k code today.

## Video output

The A500 gives you 15 kHz RGB (and a truly awful RF modulator), which most modern displays simply refuse to lock onto. The options, roughly in order of how much I care:

- **Composite (RCA)** — works everywhere, looks like a blurry mess. Fine for "does it boot."
- **RGB → SCART** — pixel-perfect on a Euro CRT. The authentic answer, if you can find a CRT that isn't a museum piece.
- **RGB2HDMI** — taps the *digital* video inside the machine (before it goes analog) and produces HDMI. Cleanest possible signal, and what I actually run.
- **Internal flicker-fixers** (Indivision ECS) and **external scalers** (OSSC, RetroTINK) — `RGB → SCART → scaler → HDMI`. Note: cheap "SCART to HDMI" adapters generally do *not* work, because they assume 31 kHz VGA input.

One of my A500s now has an **RGB2HDMI** installed alongside a **2 MB memory upgrade**, which together make it a genuinely pleasant machine to actually use rather than just admire.

## Storage

The stock A500 has no hard drive, no IDE, no SCSI — just floppies and expansion ports. So "modern storage" is really an adapter pretending to be something the Amiga understands:

- **Gotek USB floppy emulator** — cheap and easy. I've fitted one; it flashes with FlashFloppy and reads ADF images off a USB stick.
- **IDE68k + CompactFlash** — a small board that taps the 68000 socket and adds real IDE. Cheap, fast, and a fun hacker mod.
- **PiStorm** — replaces the CPU with a Raspberry Pi emulating 68k. Insanely fast, SD storage, RTG graphics. Philosophically cheating, genuinely great.

## The sidecar idea (early days)

The project I'm most excited about is still mostly on paper. The A500's sidecar expansion slot is a bus I can talk to myself — so the idea is to build an **SD-card interface for the sidecar port in Verilog**, as a way to actually learn FPGA design on a real problem instead of a tutorial.

It's very early — planning and reading, nothing built yet. But it ties together the two things I keep coming back to: retro hardware and getting my hands closer to the metal.

## 68k development environment

I use the **Amiga C/C++ extension for VS Code** for playing with Amiga code. It's a full stack — toolchain, emulator, and debugging wired together — which makes it the path of least resistance for running something on a virtual Amiga in seconds.

I'd honestly prefer to do it in Neovim. But the VS Code extension is just too handy for the full-stack workflow, so here we are.

## Why

Because the A500 is a design classic, because "retro" shouldn't mean "unusable," and because there's real satisfaction in making a 1987 machine talk to a 2026 monitor — on your own terms.
