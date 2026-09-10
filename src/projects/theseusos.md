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

- **2023** — First Rust x86 bootloader experiments, UEFI GOP framebuffer work, the Rust Book and Rustlings. Early forays into memory layout (GDT) and Rust tooling.
- **2024** — Foundation work: memory persistence, the GDT, and the first stable project scaffolding.
- **2025** — The busy year. Memory management with folios, the x86_64 Bootboot setup, LAPIC/APIC deep dives, interrupt handling, PCI vs PCIe, USB HCI enumeration, ELF loading, and the allocator switch.
- **2026** — Refinement, and continued work on driver bring-up and kernel hardening.

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
