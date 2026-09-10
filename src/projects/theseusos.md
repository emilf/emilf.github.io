---
title: TheseusOS
summary: A hobby operating system for x86_64, written in Rust. Started as a way to learn Rust, turned into an experiment in how far AI-assisted "vibe coding" can carry an OS project.
status: Active
year: 2023–present
permalink: /projects/theseusos/
---
TheseusOS is my long-running hobby kernel: a 64-bit operating system for x86_64 written in Rust. It began in 2023 as a way to finally learn Rust properly — and quickly became something more interesting. Once AI coding assistants got good enough, the project turned into a deliberate experiment: **how much of an operating system can you build by prompting, without writing the code yourself?**

I keep my hands off the implementation on purpose, even when I could do it faster myself. It's the steering and the architecture that interest me — and watching where the models over-engineer, get lost, or quietly do something clever.

## The shape of it

The bootloader and kernel build as a **single binary**, which keeps the whole bring-up path steppable from start to finish — no context switches or ELF parsing between the two halves. It's a simple choice that suits a project built mainly to understand how all this fits together. I'm not trying to build something clever, just something I can follow.

The docs are split into *axioms* (binding statements about how the machine actually works) and *plans* (evolving intentions), on the idea that a smooth-sounding narrative shouldn't quietly drift away from what the code really does.

## How it boots

It starts life as a UEFI application. While firmware services are still live, the bootloader gathers everything the kernel will need and packs it into a single **handoff structure**:

- **Graphics** — GOP resolution, pixel format, framebuffer base
- **Memory** — the full UEFI memory map, plus a reserved temporary heap
- **ACPI** — the RSDP and table addresses for later parsing
- **Hardware inventory** — enumerated device handles, classified by type
- **System info** — firmware vendor strings, boot timestamps, CPU feature flags

Then it calls `ExitBootServices`, and everything the kernel could ever need must already be in that handoff — firmware is gone. Control passes straight to `kernel_entry` as an ordinary function call. No trampoline, no protocol switching.

From there the kernel stabilises the platform: loads a fresh GDT with a TSS and IST entries for fault handlers, sets up control registers, builds a new PML4, switches CR3, and jumps to the higher half. Only after interrupts are proven to work (a one-shot LAPIC timer is fired and checked) does it bring up the allocators, drivers, and the rest of the platform.

## The memory layout

A big chunk of boot is spent establishing a deterministic virtual address space:

- A **low 1 GiB identity map**, used only during the transition away from firmware addresses
- The **higher-half kernel** at `0xFFFF_FFFF_8000_0000`, where code and data execute once paging flips
- A **`PHYS_OFFSET` linear window** at `0xFFFF_8000_0000_0000`, so any physical address is reachable as `base + phys`
- A **temporary heap** carried over from firmware, later replaced by a permanent kernel heap
- Explicit MMIO mappings for the framebuffer, LAPIC, and I/O APIC

Physical frames come from two allocators that hand off to each other: a boot-time `BootFrameAllocator` (which keeps a reserved stack so critical page-table allocations can never fail mid-bootstrap) and a long-lived bitmap allocator built from the firmware memory map once things settle. Identity mappings are optionally torn down afterwards, on purpose, to catch any stale low-half pointer that shouldn't still be in use.

## Drivers and the monitor

Devices arrive as a curated inventory from the bootloader and get turned into `Device` descriptors the kernel can probe and bind. The framework is deliberately simple — synchronous I/O, first-driver-wins binding, no hot-unplug yet — because clarity beats features at this stage.

There's a full **xHCI USB driver** (rings, MSI/MSI-X, HID boot protocol) that drives a USB keyboard, a 16550 UART serial driver, framebuffer output, PCI enumeration, and ACPI/MADT parsing.

On top of all that sits a **serial monitor** — a small homage to WozMon — with commands to inspect the machine live: `status`, `mem`, `idt`, `gdt`, `lapic`, `timer`, `devices`, `drivers`, and ad-hoc port/MMIO pokes. It's interrupt-driven, so the CPU idles with `hlt` between keystrokes rather than spinning.

## Tooling

A lot of the work has gone into making the thing pleasant to run and debug, which matters when the whole point is to *watch* the system behave:

- **`theseus-qemu`** — a Rust runner that builds, generates reproducible QEMU command lines, and manages serial/QMP/HMP relays
- **Relay architecture** — stable host-side endpoints for serial, monitor, and debug streams, so tooling can attach to a running guest
- **Automated GDB sessions** — a debug-mailbox scheme where the bootloader writes its own runtime address to a known physical location; a hardware watchpoint fires, symbols load automatically, and you land in `efi_main` with full Rust source-level debugging. No manual address copying, and section deltas are recomputed on every build so nothing goes stale.
- **A test framework** with bare-metal smoke tests, plus ISA debug-exit paths that report PASS/FAIL/PANIC/TIMEOUT

## Where it's going

The goal is a **POSIX-compatible-enough kernel** to compile and run core Unix tools — busybox, a shell, coreutils — without crippling them. The roadmap is honest about scope:

- **Phase 0 — Foundation** ✅ done (bootloader, memory, interrupts, drivers, tooling)
- **Phase 1 — CPU & platform hardening** — APIC timer calibration and CPUID abstraction done; x2APIC, TSS/IST stacks, and SMP bring-up in progress
- **Phase 2 — Scheduling** — kernel threads, context switching, a preemptive scheduler
- **Phase 3 — User mode** — per-process page tables, ring 3, SYSCALL/SYSRET
- **Phases 4–8 — Syscalls, VFS, ELF loader, libc, core tools** — the long march to `busybox`
- **Phases 9–10 — Networking and polish** — TCP/IP, pthreads, a real TTY

The roadmap's own summary of the effort is refreshingly dry: scheduling is "fiddly," VFS is "large," and polish is "ongoing forever."

## A rough timeline

The git history tells the story better than I can — but the repo came later than the idea. I started exploring a Rust OS project back in **early 2023**: first x86 bootloader experiments, UEFI framebuffer tinkering, and working through the Rust Book and Rustlings. That was the on-ramp. The public repo didn't start until mid-2025, once it was time to actually build in earnest.

**Before the repo (2023–2024)** — First Rust x86 bootloader experiments and UEFI GOP framebuffer work, alongside learning Rust properly. Early forays into memory layout and the GDT, and an early attempt at loading the kernel from the EFI System Partition.

**In the repo:**

- **June 2025** — First commit: just a QEMU invocation for a UEFI BIOS. The starting gun.
- **August 2025** — A working "hello world" and the first data hand-off from bootloader to kernel.
- **September 2025** — The big structural push: splitting the workspace into bootloader and kernel, a driver system for serial output, proper UEFI memory allocation, loading the kernel from the EFI System Partition, ELF parsing, and moving `ExitBootServices` responsibility into the kernel. There's a telling commit in here — *"Rollback. I got tired of trying to do things wrong. Trying again by the book and keeping a stricter hand on the AI helper."*
- **October 2025** — Memory and observability. A proper page-frame allocator, `SetVirtualAddressMap` to bring UEFI runtime services into the higher half, a new logging system, the serial monitor, GDB integration, and hardware inventory.
- **December 2025** — The USB era: xHCI rings, MSI/MSI-X, and the long grind of getting a USB keyboard to actually produce key events under QEMU.
- **February 2026** — Tooling maturity: the `theseus-qemu` runner with profiles and relays, relay sockets, a logging policy, and a test-strategy document.
- **March 2026** — Phase 1 hardening, x2APIC guardrails and cleanup (PRs #17–#30), the debug monitor, and automated GDB sessions.
- **June 2026** — Test automation: ISA debug-exit paths with PASS/FAIL/PANIC/TIMEOUT scenarios.

The repo is around **330 commits** at time of writing.

## The AI experiment

The original premise has aged in an interesting way. Early on, the AI agents were genuinely *bad* at Rust and systems programming — they needed extreme hand-holding, and only the best frontier models could produce anything remotely functional. Systems code, with its strict lifetimes and `unsafe` discipline, was about the hardest thing you could ask them to do.

That's changed. These days I can point a cheap model like DeepSeek Flash at the project and get good code and plans back. Even open models that fit on my 8 GB of VRAM can manage semi-competent coding — though those still need a fair amount of hand-holding, and it's usually their small context windows, not their intelligence, that breaks down on a project this complex.

The through-line hasn't changed: AI assistants consistently over-engineer and drift away from the project's "simple and clear" philosophy. Human oversight isn't optional — it's the whole point.

## A name collision

There's another Rust OS project out there that also goes by the name *TheseusOS*, and it has nothing to do with this one. The name is pure coincidence — when I picked it, that project wasn't online as far as I knew.

## Links

- Source: <https://github.com/emilf/TheseusOS>
