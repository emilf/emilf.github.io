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
- **Memory management** — GDT, folio-based paging, and a dual-allocator scheme to hand off from UEFI's allocator at `ExitBootServices`
- **Driver enumeration** — PCI/PCIe, USB host controllers, early ACPI work
- **Graphics** — PSF font rendering straight to the framebuffer, cursor and scroll handling

## A rough timeline

- **2023** — First Rust x86 bootloader experiments, UEFI GOP framebuffer work, the Rust Book and Rustlings. Early forays into memory layout (GDT) and XML/HTTP plumbing against Iceland's Hekla health API.
- **2024** — Foundation work: memory persistence, the GDT, and the first stable project scaffolding.
- **2025** — The busy year. Memory management with folios, the x86_64 Bootboot setup, LAPIC/APIC deep dives, interrupt handling, PCI vs PCIe, USB HCI enumeration, ELF loading, PSF font rendering, and the allocator switch.
- **2026** — Refinement, and the start of a sibling project, *Seraphim OS* — a next-gen Amiga-flavoured OS targeting the Apollo/68080, with a mid-90s aesthetic and a design that mirrors the Amiga's library API.

## Notes to self

- The UEFI PE target uses the **Microsoft x64 ABI** — the first four arguments go in `rcx/rdx/r8/r9`, not SysV. Assembly shims calling into Rust have to respect that or everything quietly breaks.
- AI assistants consistently over-engineer and drift away from the project's "simple and clear" philosophy. Human oversight isn't optional — it's the whole point of the experiment.

## Links

- Source: <https://github.com/emilf/TheseusOS>
