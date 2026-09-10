---
title: TheseusOS
summary: A hobby operating system for x86_64, written in Rust. Started as a way to learn Rust, turned into an experiment in how far AI-assisted "vibe coding" can carry an OS project.
status: Active
year: 2023–present
permalink: /projects/theseusos/
---
TheseusOS is my long-running hobby kernel: a 64-bit operating system for x86_64 written in Rust. It began in 2023 as a way to finally learn Rust properly — and quickly became something more interesting. Once AI coding assistants got good enough, the project turned into a deliberate experiment: **how much of an operating system can you build by prompting, without writing the code yourself?**

I keep my hands off the implementation on purpose, even when I could do it faster myself. It's the steering and the architecture that interest me — and watching where the models over-engineer, get lost, or quietly do something clever.

## What it does

- **UEFI-native boot** on x86_64, built around a clean bootloader/kernel/userland split
- **Interrupt handling** — per-vector assembly stubs dispatched to Rust handlers, with dedicated paths for spurious and APIC-error interrupts
- **x2APIC** support, enabled early at boot with cached mode helpers
- **Memory management** — GDT and folio-based paging, plus a dual-allocator scheme to hand off from UEFI's allocator at `ExitBootServices`
- **Driver enumeration** — PCI/PCIe, USB host controllers, early ACPI work

## A rough timeline

The git history tells the story better than I can — but the repo came later than the idea. I started exploring a Rust OS project back in **early 2023**: first x86 bootloader experiments, UEFI framebuffer tinkering, and working through the Rust Book and Rustlings. That was the on-ramp. The public repo didn't start until mid-2025, once it was time to actually build in earnest.

**Before the repo (2023–2024)** — First Rust x86 bootloader experiments and UEFI GOP framebuffer work, alongside learning Rust properly. Early forays into memory layout and the GDT, and an early attempt at loading the kernel from the EFI System Partition.

**In the repo:**

- **June 2025** — First commit: just a QEMU invocation for a UEFI BIOS. The starting gun.
- **August 2025** — A working "hello world" and the first data hand-off from bootloader to kernel.
- **September 2025** — The big structural push: splitting the workspace into bootloader and kernel, a driver system for serial output, proper UEFI memory allocation, loading the kernel from the EFI System Partition, ELF parsing, and moving `ExitBootServices` responsibility into the kernel. There's a telling commit in here — *"Rollback. I got tired of trying to do things wrong. Trying again by the book and keeping a stricter hand on the AI helper."*
- **October 2025** — Memory and observability. A proper page-frame allocator, `SetVirtualAddressMap` to bring UEFI runtime services into the higher half, a new logging system, a serial monitor (a homage to WozMon), GDB integration, and hardware inventory.
- **December 2025** — The USB era: xHCI rings, MSI/MSI-X, and the long grind of getting a USB keyboard to actually produce key events under QEMU.
- **February 2026** — Tooling maturity: a Rust `theseus-qemu` runner with profiles and relays, QEMU relay sockets, a logging policy, and a test-strategy document.
- **March 2026** — Phase 1 hardening, x2APIC guardrails and cleanup (PRs #17–#30), the debug monitor, and automated GDB sessions.
- **June 2026** — Test automation: ISA debug-exit paths with PASS/FAIL/PANIC/TIMEOUT scenarios.

The repo is around **330 commits** at time of writing, with the roadmap organised into phases — Phase 0 (foundation) is done, and Phase 1 (CPU and platform hardening) is well underway.

## Where it stands

**Done and working** (Phase 0): a custom UEFI bootloader, kernel ELF loaded from the ESP, higher-half mapping, physical frame allocator and kernel heap, IDT + xAPIC + APIC timer, ACPI/MADT parsing, framebuffer and serial drivers, PCI enumeration, a full xHCI USB driver with HID keyboard, a serial debug monitor, and a proper QEMU/GDB toolchain.

**The long-term goal:** a POSIX-compatible-enough kernel to compile and run core Unix tools — coreutils, busybox, a shell — without crippling them.

## The AI experiment

The original premise has aged in an interesting way. Early on, the AI agents were genuinely *bad* at Rust and systems programming — they needed extreme hand-holding, and only the best frontier models could produce anything remotely functional. Systems code, with its strict lifetimes and `unsafe` discipline, was about the hardest thing you could ask them to do.

That's changed. These days I can point a cheap model like DeepSeek Flash at the project and get good code and plans back. Even open models that fit on my 8 GB of VRAM can manage semi-competent coding — though those still need a fair amount of hand-holding, and it's usually their small context windows, not their intelligence, that breaks down on a project this complex.

The through-line hasn't changed: AI assistants consistently over-engineer and drift away from the project's "simple and clear" philosophy. Human oversight isn't optional — it's the whole point.

## A name collision

There's another Rust OS project out there that also goes by the name *TheseusOS*, and it has nothing to do with this one. The name is pure coincidence — when I picked it, that project wasn't online as far as I knew.

## Notes to self

- The UEFI PE target uses the **Microsoft x64 ABI** — the first four arguments go in `rcx/rdx/r8/r9`, not SysV. Assembly shims calling into Rust have to respect that or everything quietly breaks.

## Links

- Source: <https://github.com/emilf/TheseusOS>
