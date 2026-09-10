---
title: Amiga 500 Revival
summary: Bringing a 1987 icon into the modern era — video output, storage, FPGA scan-doubling, and a Linux-native 68k development environment.
status: Ongoing
year: 2025–present
permalink: /projects/amiga-500-revival/
---
I've got a few Amiga 500s, and 1987 hardware deserves better than a fuzzy composite signal into a modern TV. This is the ongoing project of getting them usable again — good video, real storage, and a development environment where I can actually write and run 68k code today.

## Video output

The A500 gives you 15 kHz RGB (and a truly awful RF modulator), which most modern displays simply refuse to lock onto. The options, roughly in order of how much I care:

- **Composite (RCA)** — works everywhere, looks like a blurry mess. Fine for "does it boot."
- **RGB → SCART** — pixel-perfect on a Euro CRT. The authentic answer, if you can find a CRT that isn't a museum piece.
- **RGB2HDMI** — taps the *digital* video inside the machine (before it goes analog) and produces HDMI. Cleanest possible signal, and my current gold standard.
- **Internal flicker-fixers** (Indivision ECS) and **external scalers** (OSSC, RetroTINK) — `RGB → SCART → scaler → HDMI`. Note: cheap "SCART to HDMI" adapters generally do *not* work, because they assume 31 kHz VGA input.

## Storage

The stock A500 has no hard drive, no IDE, no SCSI — just floppies and expansion ports. So "modern storage" is really an adapter pretending to be something the Amiga understands:

- **Gotek USB floppy emulator** — cheapest and easiest. Flashes with FlashFloppy, pretends to be a floppy drive, reads ADF images off a USB stick.
- **IDE68k + CompactFlash** — a small board that taps the 68000 socket and adds real IDE. Cheap, fast, and a fun hacker mod.
- **PiStorm** — replaces the CPU with a Raspberry Pi emulating 68k. Insanely fast, SD storage, RTG graphics. Philosophically cheating, genuinely great.

## FPGA scan-doubler

The interesting one. The goal: build a scan-doubler on an FPGA dev board — take the Amiga's 15 kHz RGB and double the line rate to 31 kHz so a VGA display can show it.

- **Nexys 3 (Spartan-6)** is the best "classic scan-doubler skeleton" — it has VGA output straight off the FPGA pins and enough logic/BRAM for a one- or two-line buffer. What it *lacks* is analog input, so it needs a small RGB ADC front-end (three ~8-bit ADCs sampling above ~28 MHz, with proper 75 Ω termination and sync handling).
- **Snickerdoodle (Zynq)** is more powerful if you want fancier scaling, frame buffers, or motion-adaptive de-interlace — but the Amiga still doesn't speak HDMI, so a digitising stage remains necessary.
- The key insight from the work: if you want RGB2HDMI-level quality, tap the **digital** video inside the machine rather than sampling analog RGB externally. Cleaner and simpler.

## 68k development environment

My daily driver is CachyOS, so the toolchain lives there and the code runs in an emulator:

- **vasm** (68k assembler) and **vlink** (linker) for assembly
- **vbcc** for C targeting 68k
- **FS-UAE** + launcher as the emulator, with a shared folder to shuttle compiled executables across
- Output is Amiga **HUNK** executables, run inside the emulator

Roughly: assemble or compile on Linux, drop the binary in a shared folder, run it in FS-UAE. Legal note to self: you should own a real Amiga to use Kickstart ROMs.

## Why

Because the A500 is a design classic, because "retro" shouldn't mean "unusable," and because there's real satisfaction in making a 1987 machine talk to a 2026 monitor — on your own terms.
